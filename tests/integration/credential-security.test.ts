import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { awsCredentials } from "@/db/schema";
import { resetServerEnvForTests } from "@/lib/env";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Phase 7 — credential-security review, as tests:
 *   1. the master key can be rotated without losing a single credential;
 *   2. no secret ever reaches a log line or an HTTP response.
 */
const describeSesAccount = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ses/client", () => ({ describeSesAccount, sendViaSes: vi.fn(), createSesClient: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

let redis: TestRedis;
beforeAll(async () => {
  redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
}, 30_000);

const credentials = await import("@/server/credentials");
const { createApiKey, rotateApiKey } = await import("@/server/api-keys");
const { NextRequest } = await import("next/server");
const { POST: send } = await import("@/app/api/v1/send/route");
const { closeSendQueue } = await import("@/lib/queue/send-queue");

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY!;
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
let userId: string;

beforeEach(async () => {
  describeSesAccount.mockResolvedValue({ productionAccessEnabled: false, maxSendRate: 1, max24HourSend: 200, sentLast24Hours: 0, enforcementStatus: "HEALTHY" });
  await redis.flush();
  await resetTestDb();
  userId = await createTestUser();
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  resetServerEnvForTests();
});

afterAll(async () => {
  await closeSendQueue().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

const store = (environment: "production" | "staging" = "production") =>
  credentials.storeCredential({ userId, environment, accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: SECRET, awsRegion: "ap-south-1" });

describe("master key rotation", () => {
  it("rotates every credential without loss, and the old key can then be retired", async () => {
    await store("production");
    await store("staging");
    const newKey = randomBytes(32).toString("base64");

    // Switch keys WITHOUT the previous one: the stored secret is now unreadable.
    process.env.ENCRYPTION_KEY = newKey;
    resetServerEnvForTests();
    await expect(credentials.loadSesCredentials(userId, "production")).rejects.toThrow(/decrypt/i);

    // Rotation step 1: both keys present — reads work immediately.
    process.env.ENCRYPTION_KEY_PREVIOUS = ORIGINAL_KEY;
    resetServerEnvForTests();
    expect((await credentials.loadSesCredentials(userId, "production"))?.secretAccessKey).toBe(SECRET);

    // Step 2: re-encrypt.
    expect(await credentials.reencryptAllCredentials()).toEqual({ total: 2, rotated: 2, failed: 0 });
    // Idempotent.
    expect(await credentials.reencryptAllCredentials()).toEqual({ total: 2, rotated: 0, failed: 0 });

    // Step 3: retire the old key. Everything still decrypts.
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    resetServerEnvForTests();
    expect((await credentials.loadSesCredentials(userId, "production"))?.secretAccessKey).toBe(SECRET);
    expect((await credentials.loadDeliveryCredential(userId, "staging"))?.credentials.secretAccessKey).toBe(SECRET);
  });

  it("reports rows no key can decrypt instead of skipping them silently", async () => {
    await store();
    await getDb().update(awsCredentials).set({ secretAccessKeyCiphertext: Buffer.from([1, ...randomBytes(40)]).toString("base64") });
    expect(await credentials.reencryptAllCredentials()).toEqual({ total: 1, rotated: 0, failed: 1 });
  });

  it("the stored value never contains the plaintext secret", async () => {
    await store();
    const [row] = await getDb().select().from(awsCredentials).where(eq(awsCredentials.userId, userId));
    expect(row!.secretAccessKeyCiphertext).not.toContain(SECRET);
    expect(Buffer.from(row!.secretAccessKeyCiphertext!, "base64").toString("latin1")).not.toContain(SECRET);
  });
});

describe("no secret reaches a log line or an HTTP response", () => {
  it("across credential, key and send flows — including failures", async () => {
    const output: string[] = [];
    const capture = (...args: unknown[]) => void output.push(args.map(String).join(" "));
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(capture));
    const bodies: string[] = [];

    try {
      await store();
      const { secret: apiKey, summary } = await createApiKey(userId, "k", "production");
      const rotated = await rotateApiKey(userId, summary.id, "1h");

      const req = (key: string, body: object) =>
        new NextRequest("https://app.test/api/v1/send", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-forwarded-for": "192.0.2.1" },
          body: JSON.stringify(body),
        });
      const ok = { from: "a@example.com", to: ["b@example.com"], subject: "s", text: "t" };

      for (const r of [
        await send(req(apiKey, ok)),
        await send(req(rotated!.secret, ok)),
        await send(req(`sk_live_${"Z".repeat(43)}`, ok)),
        await send(req(apiKey, { ...ok, to: "not-a-list" })),
      ]) {
        bodies.push(await r.text(), JSON.stringify([...r.headers.entries()]));
      }

      // A credential AWS rejects: the error path must not echo the secret.
      describeSesAccount.mockRejectedValueOnce(Object.assign(new Error(`signature for ${SECRET} mismatch`), { name: "SignatureDoesNotMatch" }));
      const failure = await store("staging").catch((e: Error) => e.message);
      bodies.push(String(failure));

      const haystack = [...output, ...bodies].join("\n");
      const needles = {
        "AWS secret access key": SECRET,
        "API key": apiKey,
        "rotated API key": rotated!.secret,
        "encryption key": process.env.ENCRYPTION_KEY!,
        "Authorization header": "Bearer sk_",
      };
      expect(output.length).toBeGreaterThanOrEqual(3); // the flows did log: 2 accepted + 1 unauthorized
      for (const [label, needle] of Object.entries(needles)) {
        expect(haystack.includes(needle), `${label} leaked`).toBe(false);
      }
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
