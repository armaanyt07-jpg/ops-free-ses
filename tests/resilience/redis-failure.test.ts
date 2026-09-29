import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Queue, Worker } from "bullmq";
import { inArray } from "drizzle-orm";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { emailLogs } from "@/db/schema";
import type { SendJobData } from "@/lib/queue/send-queue";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

/**
 * Phase 7 — Redis failure.
 *
 * A real redis-server with the append-only file on (`appendfsync always`, the
 * durability a managed Redis such as Upstash provides), SIGKILLed — no clean
 * shutdown — and restarted on the same data directory.
 */
const accepted = new Map<string, number>();
const sendViaSes = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ses/client", () => ({
  sendViaSes,
  describeSesAccount: vi.fn(async () => ({ productionAccessEnabled: true, maxSendRate: 200, max24HourSend: 1e6, sentLast24Hours: 0, enforcementStatus: "HEALTHY" })),
  createSesClient: vi.fn(),
}));

const { createSendProcessor } = await import("../../worker/processor");
const { storeCredential } = await import("@/server/credentials");

const dir = mkdtempSync(join(tmpdir(), "ops-redis-aof-"));
let port = 0;
let proc: ChildProcess | undefined;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

async function startRedis() {
  proc = spawn("redis-server", ["--port", String(port), "--bind", "127.0.0.1", "--dir", dir, "--appendonly", "yes", "--appendfsync", "always", "--save", ""], { stdio: "ignore" });
  const probe = new Redis({ port, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  probe.on("error", () => undefined);
  for (let i = 0; i < 100; i++) {
    try {
      await probe.connect();
      await probe.ping();
      probe.disconnect();
      return;
    } catch {
      probe.disconnect();
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("redis did not start");
}

function crashRedis() {
  proc?.kill("SIGKILL");
  proc = undefined;
}

const connection = () => ({ host: "127.0.0.1", port, maxRetriesPerRequest: null, retryStrategy: (n: number) => Math.min(n * 100, 1_000) });

beforeAll(async () => {
  port = await freePort();
  await startRedis();
  await resetTestDb();
  sendViaSes.mockImplementation(async (_c: unknown, input: { subject: string }) => {
    await new Promise((r) => setTimeout(r, 10));
    accepted.set(input.subject, (accepted.get(input.subject) ?? 0) + 1);
    return { messageId: `ses-${input.subject}`, requestId: "r" };
  });
}, 30_000);

afterAll(async () => {
  crashRedis();
  rmSync(dir, { recursive: true, force: true });
  await closeTestDb();
});

async function seed(queue: Queue<SendJobData>, n: number) {
  const userId = await createTestUser();
  await storeCredential({ userId, environment: "production", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", awsRegion: "ap-south-1" });
  const rows = await getDb()
    .insert(emailLogs)
    .values(Array.from({ length: n }, () => ({ userId, environment: "production" as const, status: "queued" as const, fromAddress: "a@x.com", recipients: ["b@x.com"], subject: "p" })))
    .returning({ id: emailLogs.id });
  await queue.addBulk(rows.map((r) => ({ name: "send", data: { logId: r.id, userId, environment: "production", requestId: "redis", from: "a@x.com", to: ["b@x.com"], subject: r.id, text: "x" }, opts: { jobId: `log-${r.id}`, attempts: 20 } })));
  return rows.map((r) => r.id);
}

async function statusCounts(ids: string[]) {
  const rows = await getDb().select({ status: emailLogs.status }).from(emailLogs).where(inArray(emailLogs.id, ids));
  return rows.filter((r) => r.status === "sent").length;
}

function evidence(name: string, data: Record<string, unknown>) {
  mkdirSync("test-results", { recursive: true });
  appendFileSync("test-results/resilience.jsonl", `${JSON.stringify({ test: name, at: new Date().toISOString(), ...data })}\n`);
}

describe("Redis failure", () => {
  it("queued jobs survive a hard Redis crash (SIGKILL) and are all delivered after restart", async () => {
    const queue = new Queue<SendJobData>("redis-crash", { connection: connection() });
    const ids = await seed(queue, 300);
    await queue.close();

    crashRedis();
    await startRedis();

    const workerRedis = new Redis(connection());
    workerRedis.on("error", () => undefined);
    const worker = new Worker<SendJobData>("redis-crash", createSendProcessor({ redis: workerRedis }), { connection: connection(), concurrency: 10 });
    worker.on("error", () => undefined);
    try {
      for (let i = 0; i < 300 && (await statusCounts(ids)) < ids.length; i++) await new Promise((r) => setTimeout(r, 200));
      expect(await statusCounts(ids)).toBe(300);
      expect(ids.every((id) => accepted.get(id) === 1)).toBe(true);
    } finally {
      await worker.close(true);
      workerRedis.disconnect();
    }
    evidence("redis_crash_while_queued", { messages: 300, aof: "appendfsync always", lost: 0, duplicates: 0 });
  });

  it("a Redis outage mid-delivery: workers reconnect and finish; nothing is lost", async () => {
    const queue = new Queue<SendJobData>("redis-outage", { connection: connection() });
    queue.on("error", () => undefined);
    const ids = await seed(queue, 400);

    const workerRedis = new Redis(connection());
    workerRedis.on("error", () => undefined);
    const worker = new Worker<SendJobData>("redis-outage", createSendProcessor({ redis: workerRedis }), {
      connection: connection(),
      concurrency: 5,
      lockDuration: 2_000,
      stalledInterval: 1_000,
      maxStalledCount: 10,
      settings: { backoffStrategy: () => 100 },
    });
    worker.on("error", () => undefined);

    try {
      // Let delivery get going, then take Redis away for 2 seconds.
      for (let i = 0; i < 100 && (await statusCounts(ids)) < 50; i++) await new Promise((r) => setTimeout(r, 50));
      const sentBeforeOutage = await statusCounts(ids);
      crashRedis();
      await new Promise((r) => setTimeout(r, 2_000));
      await startRedis();

      for (let i = 0; i < 600 && (await statusCounts(ids)) < ids.length; i++) await new Promise((r) => setTimeout(r, 200));
      expect(await statusCounts(ids)).toBe(400);

      const duplicates = ids.filter((id) => (accepted.get(id) ?? 0) > 1).length;
      // At-least-once: a message SES accepted in the instant before Redis died,
      // with its acceptance record not yet persisted, can be sent again. Bounded
      // by the jobs in flight at the crash (concurrency 5).
      expect(duplicates).toBeLessThanOrEqual(5);
      evidence("redis_outage_mid_delivery", { messages: 400, sentBeforeOutage, outageSeconds: 2, lost: 0, duplicates, inFlightBound: 5 });
    } finally {
      await worker.close(true);
      workerRedis.disconnect();
      await queue.close().catch(() => undefined);
    }
  });
});
