import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * GET /api/health/worker — the uptime probe for the send worker, against a
 * real Redis. The route caches its answer, so each test loads a fresh copy.
 */
let redis: TestRedis;
beforeAll(async () => {
  redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
}, 30_000);

beforeEach(async () => {
  await redis.flush();
  vi.resetModules();
});

afterAll(async () => {
  await redis.stop();
});

async function probe(): Promise<{ status: number; body: unknown }> {
  const { GET } = await import("@/app/api/health/worker/route");
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

function heartbeat(workerId: string, beatAt: Date) {
  return JSON.stringify({
    workerId,
    pid: 4242,
    host: "railway-host-secret",
    concurrency: 5,
    startedAt: beatAt.toISOString(),
    beatAt: beatAt.toISOString(),
    processed: 0,
    failed: 0,
  });
}

describe("worker health probe", () => {
  it("is 200 with the count of fresh heartbeats", async () => {
    await redis.client.set("worker:heartbeat:w-1", heartbeat("w-1", new Date()), "PX", 35_000);
    await redis.client.set("worker:heartbeat:w-2", heartbeat("w-2", new Date()), "PX", 35_000);

    expect(await probe()).toEqual({ status: 200, body: { status: "ok", workers: 2 } });
  });

  it("is 503 when no worker has beaten", async () => {
    expect(await probe()).toEqual({ status: 503, body: { status: "down", workers: 0 } });
  });

  it("does not count a heartbeat older than its TTL", async () => {
    await redis.client.set("worker:heartbeat:w-1", heartbeat("w-1", new Date(Date.now() - 60_000)), "PX", 35_000);

    expect(await probe()).toEqual({ status: 503, body: { status: "down", workers: 0 } });
  });

  it("finds heartbeats among a large BullMQ keyspace", async () => {
    const pipeline = redis.client.pipeline();
    for (let i = 0; i < 3_000; i++) pipeline.set(`bull:send:${i}`, "x");
    await pipeline.exec();
    await redis.client.set("worker:heartbeat:w-1", heartbeat("w-1", new Date()), "PX", 35_000);

    expect(await probe()).toEqual({ status: 200, body: { status: "ok", workers: 1 } });
  });

  it("reveals no host, process id or error text", async () => {
    await redis.client.set("worker:heartbeat:w-1", heartbeat("w-1", new Date()), "PX", 35_000);

    const { body } = await probe();
    expect(JSON.stringify(body)).not.toMatch(/railway-host-secret|4242|w-1/);
  });

  it("is 503 'unknown' when Redis is not configured", async () => {
    const url = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      expect(await probe()).toEqual({ status: 503, body: { status: "unknown", workers: 0 } });
    } finally {
      process.env.REDIS_URL = url;
    }
  });
});
