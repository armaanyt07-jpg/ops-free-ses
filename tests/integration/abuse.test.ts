import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailLogs } from "@/db/schema";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Phase 7 — API abuse protection, against real Redis and PostgreSQL.
 * Small limits are configured so the behaviour is observable in a few requests.
 */
process.env.RATE_LIMIT_KEY_PER_SECOND = "1";
process.env.RATE_LIMIT_KEY_BURST = "3";
process.env.RATE_LIMIT_IP_PER_SECOND = "1";
process.env.RATE_LIMIT_IP_BURST = "6";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("@/lib/ses/client", () => ({ describeSesAccount: vi.fn(), sendViaSes: vi.fn(), createSesClient: vi.fn() }));
const tenant = vi.hoisted(() => ({ current: { id: "", email: "t@example.test", displayName: null } }));
vi.mock("@/server/tenant", () => ({ requireTenant: async () => tenant.current }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let redis: TestRedis;
beforeAll(async () => {
  redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
}, 30_000);

const { NextRequest } = await import("next/server");
const { POST: send } = await import("@/app/api/v1/send/route");
const { POST: webhook } = await import("@/app/api/v1/webhooks/aws-sns/route");
const { POST: signout } = await import("@/app/auth/signout/route");
const { createApiKey } = await import("@/server/api-keys");
const { setAbuseRedisForTests } = await import("@/server/abuse");
const { sendTestEmail } = await import("@/app/dashboard/actions");
const { closeSendQueue } = await import("@/lib/queue/send-queue");

let key: string;
let userId: string;
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;

beforeEach(async () => {
  await redis.flush();
  await resetTestDb();
  userId = await createTestUser();
  tenant.current = { id: userId, email: "t@example.test", displayName: null };
  key = (await createApiKey(userId, "k", "production")).secret;
  setAbuseRedisForTests(undefined);
});

afterAll(async () => {
  await closeSendQueue().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

const BODY = { from: "a@example.com", to: ["b@example.com"], subject: "s", text: "t" };

function sendReq(opts: { key?: string; ip?: string; body?: string } = {}) {
  return new NextRequest("https://app.test/api/v1/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.key ?? key}`,
      "content-type": "application/json",
      "x-forwarded-for": opts.ip ?? freshIp(),
    },
    body: opts.body ?? JSON.stringify(BODY),
  });
}

describe("per-API-key limit (SRS §7: 429)", () => {
  it("allows the burst, then answers 429 RATE_LIMITED with Retry-After", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await send(sendReq())).status);
    expect(statuses).toEqual([202, 202, 202, 429, 429]);

    const limited = await send(sendReq());
    expect((await limited.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("limits each key independently", async () => {
    for (let i = 0; i < 3; i++) await send(sendReq());
    expect((await send(sendReq())).status).toBe(429);
    const other = (await createApiKey(userId, "k2", "production")).secret;
    expect((await send(sendReq({ key: other }))).status).toBe(202);
  });

  it("refills over time", async () => {
    for (let i = 0; i < 3; i++) await send(sendReq());
    expect((await send(sendReq())).status).toBe(429);
    await new Promise((r) => setTimeout(r, 1_100));
    expect((await send(sendReq())).status).toBe(202);
  });
});

describe("per-IP limit, before any database work", () => {
  it("throttles a flood of invalid keys from one address", async () => {
    const ip = "198.51.100.7";
    const statuses = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await send(sendReq({ ip, key: `sk_live_${"x".repeat(43)}` }))).status);
    }
    expect(statuses.slice(0, 6)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(statuses.slice(6)).toEqual([429, 429]);
  });

  it("applies to the webhook too", async () => {
    const ip = "198.51.100.9";
    const statuses = [];
    const started = Date.now();
    for (let i = 0; i < 110; i++) {
      const r = await webhook(
        new NextRequest("https://app.test/api/v1/webhooks/aws-sns", {
          method: "POST",
          headers: { "x-forwarded-for": ip, "content-type": "text/plain" },
          body: "junk",
        }),
      );
      statuses.push(r.status);
    }
    // The bucket refills at 50/s while the loop runs, so the exact count
    // depends on speed. The invariant: at least the burst, never more than
    // burst + rate × elapsed.
    const allowed = statuses.filter((s) => s === 400).length;
    const elapsedSeconds = (Date.now() - started) / 1000;
    expect(allowed).toBeGreaterThanOrEqual(100);
    expect(allowed).toBeLessThanOrEqual(100 + Math.ceil(50 * elapsedSeconds));
    expect(statuses.at(-1)).toBe(429);
  }, 30_000);
});

describe("fails open when Redis is unreachable", () => {
  it("a limiter outage does not reject requests", async () => {
    const dead = new Redis("redis://127.0.0.1:1", { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
    dead.on("error", () => undefined);
    setAbuseRedisForTests(dead);
    try {
      const res = await send(sendReq());
      // Not 429: the limiter stepped aside. (202 — the queue itself is healthy.)
      expect(res.status).toBe(202);
    } finally {
      setAbuseRedisForTests(undefined);
      dead.disconnect();
    }
  });
});

describe("request size", () => {
  it("refuses a body over 2 MB with 413 and writes nothing", async () => {
    const huge = JSON.stringify({ ...BODY, html: "x".repeat(2.2 * 1024 * 1024) });
    const res = await send(sendReq({ body: huge }));
    expect(res.status).toBe(413);
    expect(await getDb().select().from(emailLogs)).toHaveLength(0);
  });

  it("counts the stream, not just a declared Content-Length", async () => {
    const huge = "x".repeat(2.5 * 1024 * 1024);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(huge));
        controller.close();
      },
    });
    const req = new NextRequest("https://app.test/api/v1/send", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "x-forwarded-for": freshIp() },
      body: stream,
      duplex: "half",
    } as never);
    expect((await send(req)).status).toBe(413);
  });
});

describe("dashboard test sends", () => {
  it("are limited per tenant", async () => {
    const form = () => {
      const f = new FormData();
      f.set("from", "a@example.com");
      f.set("to", "success@simulator.amazonses.com");
      f.set("subject", "s");
      f.set("text", "t");
      return f;
    };
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await sendTestEmail({}, form()));
    expect(results.slice(0, 5).every((r) => r.sent)).toBe(true);
    expect(results[5]?.error).toMatch(/Too many test sends/);
  });
});

describe("sign-out CSRF", () => {
  it("refuses a cross-site POST", async () => {
    const res = await signout(
      new NextRequest("https://app.test/auth/signout", { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(res.status).toBe(403);
  });
});

describe("security headers", () => {
  it("frames forbidden, nosniff, referrer policy, report-only CSP; HSTS in production", async () => {
    const config = (await import("../../next.config")).default;
    const headersFor = async (env: string) => {
      vi.stubEnv("NODE_ENV", env);
      const [rule] = await config.headers!();
      vi.unstubAllEnvs();
      return Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));
    };

    const prod = await headersFor("production");
    expect(prod).toMatchObject({
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    expect(prod["Strict-Transport-Security"]).toMatch(/max-age=63072000/);
    expect(prod["Content-Security-Policy-Report-Only"]).toMatch(/frame-ancestors 'none'/);
    expect(prod["Content-Security-Policy-Report-Only"]).not.toMatch(/unsafe-eval/);
    expect(config.poweredByHeader).toBe(false);

    const dev = await headersFor("development");
    expect(dev["Strict-Transport-Security"]).toBeUndefined();
  });
});
