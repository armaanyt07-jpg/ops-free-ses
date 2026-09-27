import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SEND_RATE,
  acquireSendToken,
  bucketKey,
} from "@/lib/queue/rate-limiter";

import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * SRS FR-4: "The system must not intentionally exceed the configured provider
 * rate." These run against a real Redis because the limiter is a Lua script
 * whose entire value is atomicity under concurrency.
 */
let redis: TestRedis;

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

beforeAll(async () => {
  redis = await startTestRedis();
}, 30_000);

beforeEach(async () => {
  await redis.flush();
});

afterAll(async () => {
  await redis.stop();
});

describe("token bucket", () => {
  it("allows the first call on a cold bucket", async () => {
    const decision = await acquireSendToken(redis.client, USER, "production", 5);
    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterMs).toBe(0);
  });

  it("allows exactly `rate` calls in a burst, then denies", async () => {
    const rate = 5;
    const results = [];
    for (let i = 0; i < rate + 3; i += 1) {
      results.push(await acquireSendToken(redis.client, USER, "production", rate));
    }

    expect(results.filter((r) => r.allowed)).toHaveLength(rate);
    expect(results.slice(rate).every((r) => !r.allowed)).toBe(true);
  });

  it("reports a positive wait when denied, so the caller can re-delay", async () => {
    await acquireSendToken(redis.client, USER, "production", 1);
    const denied = await acquireSendToken(redis.client, USER, "production", 1);

    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    // At 1/sec, the next token is at most a second away.
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1_000);
  });

  it("never returns a zero wait on denial, which would spin", async () => {
    await acquireSendToken(redis.client, USER, "production", 100);
    for (let i = 0; i < 200; i += 1) {
      const d = await acquireSendToken(redis.client, USER, "production", 100);
      if (!d.allowed) {
        expect(d.retryAfterMs).toBeGreaterThanOrEqual(50);
        return;
      }
    }
    throw new Error("bucket never denied — capacity is not bounded");
  });

  it("refills over time", async () => {
    const rate = 10; // 10/sec => a token every 100ms
    for (let i = 0; i < rate; i += 1) {
      await acquireSendToken(redis.client, USER, "production", rate);
    }
    expect(
      (await acquireSendToken(redis.client, USER, "production", rate)).allowed,
    ).toBe(false);

    await new Promise((r) => setTimeout(r, 350));

    expect(
      (await acquireSendToken(redis.client, USER, "production", rate)).allowed,
    ).toBe(true);
  });

  it("never exceeds the configured rate over a sustained window", async () => {
    const rate = 10;
    const started = Date.now();
    let granted = 0;

    // Hammer for ~1s; the bucket may grant at most one second of burst plus
    // one second of refill.
    while (Date.now() - started < 1_000) {
      const d = await acquireSendToken(redis.client, USER, "production", rate);
      if (d.allowed) granted += 1;
    }

    const elapsedSec = (Date.now() - started) / 1000;
    const ceiling = Math.ceil(rate * elapsedSec) + rate; // refill + burst
    expect(granted).toBeLessThanOrEqual(ceiling);
    expect(granted).toBeGreaterThan(0);
  });
});

describe("isolation", () => {
  it("keeps tenants independent", async () => {
    await acquireSendToken(redis.client, USER, "production", 1);
    expect(
      (await acquireSendToken(redis.client, USER, "production", 1)).allowed,
    ).toBe(false);

    // A different tenant is unaffected by the first tenant's exhaustion.
    expect(
      (await acquireSendToken(redis.client, OTHER, "production", 1)).allowed,
    ).toBe(true);
  });

  it("keeps environments independent", async () => {
    await acquireSendToken(redis.client, USER, "production", 1);
    expect(
      (await acquireSendToken(redis.client, USER, "production", 1)).allowed,
    ).toBe(false);

    expect(
      (await acquireSendToken(redis.client, USER, "staging", 1)).allowed,
    ).toBe(true);
  });

  it("uses distinct keys per tenant and environment", () => {
    expect(bucketKey(USER, "production")).not.toBe(bucketKey(USER, "staging"));
    expect(bucketKey(USER, "production")).not.toBe(bucketKey(OTHER, "production"));
  });
});

describe("rate resolution", () => {
  // Guessing high would mean deliberately exceeding a provider limit.
  it("falls back to the sandbox default when AWS reported no rate", async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await acquireSendToken(redis.client, USER, "production", null));
    }
    expect(results.filter((r) => r.allowed)).toHaveLength(DEFAULT_SEND_RATE);
  });

  it("falls back rather than treating zero as unlimited", async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await acquireSendToken(redis.client, USER, "production", 0));
    }
    expect(results.filter((r) => r.allowed)).toHaveLength(DEFAULT_SEND_RATE);
  });

  it("handles a fractional rate without granting a free burst", async () => {
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await acquireSendToken(redis.client, USER, "production", 0.5));
    }
    expect(results.filter((r) => r.allowed).length).toBeLessThanOrEqual(1);
  });
});

/**
 * The reason the limiter is a Lua script rather than a read-then-write from
 * the client: concurrent workers must not both observe the same token.
 */
describe("atomicity under concurrency", () => {
  it("grants at most `rate` tokens to simultaneous callers", async () => {
    const rate = 5;
    const decisions = await Promise.all(
      Array.from({ length: 40 }, () =>
        acquireSendToken(redis.client, USER, "production", rate),
      ),
    );

    expect(decisions.filter((d) => d.allowed)).toHaveLength(rate);
  });

  it("holds when the callers are separate connections, as real workers are", async () => {
    const { Redis } = await import("ioredis");
    const clients = Array.from(
      { length: 8 },
      () => new Redis(redis.url, { maxRetriesPerRequest: null, enableReadyCheck: false }),
    );

    try {
      const decisions = await Promise.all(
        clients.flatMap((c) =>
          Array.from({ length: 5 }, () =>
            acquireSendToken(c, USER, "production", 6),
          ),
        ),
      );
      expect(decisions.filter((d) => d.allowed)).toHaveLength(6);
    } finally {
      await Promise.all(clients.map((c) => c.quit().catch(() => undefined)));
    }
  });
});
