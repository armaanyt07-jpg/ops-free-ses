import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync } from "node:fs";

import { Queue, Worker } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailLogs } from "@/db/schema";
import type { SendJobData } from "@/lib/queue/send-queue";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Phase 7 — queue stress and worker failure.
 *
 * Real Redis, real BullMQ, real processor, real PostgreSQL (PGlite). SES is
 * simulated with latency. The property checked throughout is the one that
 * matters to a customer: every accepted message is delivered, and SES accepts
 * each message exactly once.
 *
 * Worker death is simulated faithfully: each worker's processing runs in its
 * own async context, and a "killed" worker's in-flight SES calls never return
 * (a dead process completes nothing), then the worker is force-closed. Its
 * jobs' locks expire and other workers must recover them.
 */
const worker = new AsyncLocalStorage<string>();
const dead = new Set<string>();
const accepted = new Map<string, number>(); // subject (= log id) → SES acceptances
const sesTimes: Array<{ tenant: string; at: number }> = [];
const faults = vi.hoisted(() => ({ markSentFailureRate: 0 }));

const sendViaSes = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ses/client", () => ({
  sendViaSes,
  describeSesAccount: vi.fn(async () => ({ productionAccessEnabled: true, maxSendRate: 100, max24HourSend: 1e6, sentLast24Hours: 0, enforcementStatus: "HEALTHY" })),
  createSesClient: vi.fn(),
}));
vi.mock("@/server/email-logs", async (orig) => {
  const real = await orig<typeof import("@/server/email-logs")>();
  return {
    ...real,
    // Injected database failure *after* SES accepted the message.
    markSent: async (...args: Parameters<typeof real.markSent>) => {
      if (Math.random() < faults.markSentFailureRate) throw new Error("injected: database unavailable");
      return real.markSent(...args);
    },
  };
});

let redis: TestRedis;
beforeAll(async () => {
  redis = await startTestRedis();
}, 30_000);

const { createSendProcessor } = await import("../../worker/processor");
const { storeCredential } = await import("@/server/credentials");

const QUEUE = "resilience-send";
let queue: Queue<SendJobData>;
const workers = new Map<string, Worker>();
let workerSeq = 0;

function startWorker(concurrency = 10) {
  const id = `w${++workerSeq}`;
  const processor = createSendProcessor({ redis: redis.client });
  const w = new Worker<SendJobData>(QUEUE, (job, token) => worker.run(id, () => processor(job, token)), {
    connection: { host: "127.0.0.1", port: redis.port },
    concurrency,
    lockDuration: 1_500,
    stalledInterval: 500,
    maxStalledCount: 10,
    settings: { backoffStrategy: () => 50 },
  });
  w.on("error", () => undefined);
  workers.set(id, w);
  return id;
}

async function kill(id: string) {
  dead.add(id);
  await workers.get(id)?.close(true);
  workers.delete(id);
}

beforeEach(async () => {
  accepted.clear();
  sesTimes.length = 0;
  dead.clear();
  faults.markSentFailureRate = 0;
  sendViaSes.mockReset();
  sendViaSes.mockImplementation(async (_creds: unknown, input: { subject: string; from: string }) => {
    const id = worker.getStore();
    if (id && dead.has(id)) return new Promise(() => undefined); // a dead process never returns
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 10));
    if (id && dead.has(id)) return new Promise(() => undefined);
    accepted.set(input.subject, (accepted.get(input.subject) ?? 0) + 1);
    sesTimes.push({ tenant: input.from, at: Date.now() });
    return { messageId: `ses-${input.subject}`, requestId: "r" };
  });
  await redis.flush();
  await resetTestDb();
  queue = new Queue<SendJobData>(QUEUE, { connection: { host: "127.0.0.1", port: redis.port } });
});

afterAll(async () => {
  await Promise.all([...workers.values()].map((w) => w.close(true).catch(() => undefined)));
  await queue?.close().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

/** Creates N logs spread over `tenants`, enqueues their jobs, returns log ids. */
async function seed(n: number, tenants: number): Promise<string[]> {
  const owners: string[] = [];
  for (let t = 0; t < tenants; t++) {
    const userId = await createTestUser();
    await storeCredential({ userId, environment: "production", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", awsRegion: "ap-south-1" });
    owners.push(userId);
  }
  const ids: string[] = [];
  for (let i = 0; i < n; i += 250) {
    const rows = await getDb()
      .insert(emailLogs)
      .values(
        Array.from({ length: Math.min(250, n - i) }, (_, k) => ({
          userId: owners[(i + k) % tenants]!,
          environment: "production" as const,
          status: "queued" as const,
          fromAddress: `t${(i + k) % tenants}@example.com`,
          recipients: ["r@example.com"],
          subject: "pending",
        })),
      )
      .returning({ id: emailLogs.id, userId: emailLogs.userId, fromAddress: emailLogs.fromAddress });
    await queue.addBulk(
      rows.map((r) => ({
        name: "send",
        data: { logId: r.id, userId: r.userId, environment: "production", requestId: "stress", from: r.fromAddress, to: ["r@example.com"], subject: r.id, text: "x" },
        opts: { jobId: `log-${r.id}`, attempts: 20, backoff: { type: "custom" } },
      })),
    );
    ids.push(...rows.map((r) => r.id));
  }
  return ids;
}

async function waitAllSent(ids: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await getDb().select({ status: emailLogs.status }).from(emailLogs).where(inArray(emailLogs.id, ids));
    const sent = rows.filter((r) => r.status === "sent").length;
    if (sent === ids.length) return;
    if (Date.now() > deadline) throw new Error(`only ${sent}/${ids.length} sent`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Appends a measurement to test-results/resilience.jsonl (quoted in docs/testing/EVIDENCE.md). */
function evidence(name: string, data: Record<string, unknown>) {
  mkdirSync("test-results", { recursive: true });
  appendFileSync("test-results/resilience.jsonl", `${JSON.stringify({ test: name, at: new Date().toISOString(), ...data })}\n`);
}

describe("queue stress", () => {
  it("2,000 messages across 4 tenants, 3 workers × 10: all delivered, SES accepts each exactly once, per-tenant rate held", async () => {
    const ids = await seed(2_000, 4);
    const start = Date.now();
    for (let i = 0; i < 3; i++) startWorker(10);

    await waitAllSent(ids, 120_000);
    const elapsed = (Date.now() - start) / 1000;

    const counts = ids.map((id) => accepted.get(id) ?? 0);
    expect(counts.filter((c) => c === 0).length, "lost").toBe(0);
    expect(counts.filter((c) => c > 1).length, "duplicated").toBe(0);

    // Token bucket: rate 100/s, burst 100 → at most 200 in any 1-second window per tenant.
    let worstWindow = 0;
    for (const tenant of new Set(sesTimes.map((s) => s.tenant))) {
      const times = sesTimes.filter((s) => s.tenant === tenant).map((s) => s.at).sort((a, b) => a - b);
      for (let i = 0, j = 0; i < times.length; i++) {
        while (times[i]! - times[j]! >= 1000) j++;
        worstWindow = Math.max(worstWindow, i - j + 1);
      }
    }
    expect(worstWindow).toBeLessThanOrEqual(200);

    evidence("queue_stress", { messages: 2000, tenants: 4, workers: 3, concurrency: 10, seconds: elapsed, perSecond: Math.round(2000 / elapsed), lost: 0, duplicates: 0, worstTenantWindowPerSecond: worstWindow, tenantRateLimit: 100 });
  });
});

describe("worker failure", () => {
  it("killing workers mid-delivery, repeatedly: nothing lost, nothing sent twice", async () => {
    const ids = await seed(600, 3);
    for (let i = 0; i < 3; i++) startWorker(8);

    let kills = 0;
    const chaos = setInterval(() => {
      const victim = [...workers.keys()][Math.floor(Math.random() * workers.size)];
      if (victim) {
        void kill(victim);
        kills += 1;
      }
      startWorker(8);
    }, 400);

    try {
      await waitAllSent(ids, 150_000);
    } finally {
      clearInterval(chaos);
    }

    const counts = ids.map((id) => accepted.get(id) ?? 0);
    expect(counts.filter((c) => c === 0).length, "lost").toBe(0);
    expect(counts.filter((c) => c > 1).length, "sent twice").toBe(0);
    expect(kills).toBeGreaterThan(3);
    evidence("worker_chaos", { messages: 600, workersKilled: kills, lost: 0, duplicates: 0 });
  });

  it("a database failure after SES accepted never re-sends (30% of markSent calls fail)", async () => {
    faults.markSentFailureRate = 0.3;
    const ids = await seed(300, 2);
    for (let i = 0; i < 2; i++) startWorker(8);

    await waitAllSent(ids, 120_000);

    const counts = ids.map((id) => accepted.get(id) ?? 0);
    expect(counts.filter((c) => c !== 1).length, "not exactly once").toBe(0);
    const [row] = await getDb().select().from(emailLogs).where(eq(emailLogs.id, ids[0]!));
    expect(row?.messageId).toBe(`ses-${ids[0]}`);
    evidence("db_failure_after_send", { messages: 300, markSentFailureRate: 0.3, resends: 0 });
  });
});
