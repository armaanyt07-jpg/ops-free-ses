import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import type { SendJobData } from "@/lib/queue/send-queue";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Phase 7 — database failure and recovery.
 */
const faults = vi.hoisted(() => ({ authDown: false, persistDown: false, markSendingFailures: 0 }));
const accepted = new Map<string, number>();

vi.mock("@/lib/ses/client", () => ({
  sendViaSes: vi.fn(async (_c: unknown, input: { subject: string }) => {
    accepted.set(input.subject, (accepted.get(input.subject) ?? 0) + 1);
    return { messageId: `ses-${input.subject}`, requestId: "r" };
  }),
  describeSesAccount: vi.fn(async () => ({ productionAccessEnabled: true, maxSendRate: 100, max24HourSend: 1e6, sentLast24Hours: 0, enforcementStatus: "HEALTHY" })),
  createSesClient: vi.fn(),
}));
vi.mock("@/server/api-keys", async (orig) => {
  const real = await orig<typeof import("@/server/api-keys")>();
  return {
    ...real,
    authenticateApiKey: async (...a: Parameters<typeof real.authenticateApiKey>) => {
      if (faults.authDown) throw new Error("injected: connection terminated unexpectedly");
      return real.authenticateApiKey(...a);
    },
  };
});
vi.mock("@/server/email-logs", async (orig) => {
  const real = await orig<typeof import("@/server/email-logs")>();
  return {
    ...real,
    createQueuedLog: async (...a: Parameters<typeof real.createQueuedLog>) => {
      if (faults.persistDown) throw new Error("injected: database unavailable");
      return real.createQueuedLog(...a);
    },
    markSending: async (...a: Parameters<typeof real.markSending>) => {
      if (faults.markSendingFailures > 0) {
        faults.markSendingFailures -= 1;
        throw new Error("injected: database unavailable");
      }
      return real.markSending(...a);
    },
  };
});
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

let redis: TestRedis;
beforeAll(async () => {
  redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
}, 30_000);

const { NextRequest } = await import("next/server");
const { POST: send } = await import("@/app/api/v1/send/route");
const { createApiKey } = await import("@/server/api-keys");
const { storeCredential } = await import("@/server/credentials");
const { reconcileStrandedLogs } = await import("@/server/reconcile");
const { createSendProcessor } = await import("../../worker/processor");
const { getSendQueue, closeSendQueue, SEND_QUEUE_NAME } = await import("@/lib/queue/send-queue");

let userId: string;
let key: string;

beforeEach(async () => {
  Object.assign(faults, { authDown: false, persistDown: false, markSendingFailures: 0 });
  accepted.clear();
  await redis.flush();
  await resetTestDb();
  userId = await createTestUser();
  key = (await createApiKey(userId, "k", "production")).secret;
  await storeCredential({ userId, environment: "production", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", awsRegion: "ap-south-1" });
});

afterAll(async () => {
  await closeSendQueue().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

function evidence(name: string, data: Record<string, unknown>) {
  mkdirSync("test-results", { recursive: true });
  appendFileSync("test-results/resilience.jsonl", `${JSON.stringify({ test: name, at: new Date().toISOString(), ...data })}\n`);
}

const request = () =>
  new NextRequest("https://app.test/api/v1/send", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
    body: JSON.stringify({ from: "a@example.com", to: ["b@example.com"], subject: "s", text: "t" }),
  });

describe("database outage at the API", () => {
  it("during authentication: a JSON error envelope with a request id, not a bare 500", async () => {
    faults.authDown = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await send(request());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toMatchObject({ code: "INTERNAL_ERROR", requestId: expect.stringMatching(/^req_/) });
    // Reported once, structured and fingerprinted.
    const report = errors.mock.calls.map((c) => String(c[0])).find((l) => l.includes("error.unhandled"));
    expect(JSON.parse(report!)).toMatchObject({ source: "route", route: "send", fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/) });
    errors.mockRestore();
  });

  it("while persisting: 503 and nothing enqueued — a 202 is never given for an unrecorded message", async () => {
    faults.persistDown = true;
    const res = await send(request());
    expect(res.status).toBe(503);
    expect((await getSendQueue().getJobCounts("waiting")).waiting).toBe(0);
  });
});

describe("database outage in the worker", () => {
  it("retries until the database is back, then sends exactly once", async () => {
    const res = await send(request());
    const { id } = await res.json();
    await getDb().update(schema.emailLogs).set({ subject: id }).where(eq(schema.emailLogs.id, id));
    const job = await getSendQueue().getJob(`log-${id}`);
    await job!.updateData({ ...job!.data, subject: id });

    faults.markSendingFailures = 3;
    const worker = new Worker<SendJobData>(SEND_QUEUE_NAME, createSendProcessor({ redis: redis.client }), {
      connection: { host: "127.0.0.1", port: redis.port },
      settings: { backoffStrategy: () => 50 },
    });
    try {
      for (let i = 0; i < 100; i++) {
        const [row] = await getDb().select().from(schema.emailLogs).where(eq(schema.emailLogs.id, id));
        if (row?.status === "sent") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const [row] = await getDb().select().from(schema.emailLogs).where(eq(schema.emailLogs.id, id));
      expect(row?.status).toBe("sent");
      expect(accepted.get(id)).toBe(1);
      expect(faults.markSendingFailures).toBe(0);
    } finally {
      await worker.close();
    }
    evidence("db_outage_in_worker", { failedAttempts: 3, finalStatus: "sent", sesAcceptances: 1 });
  });
});

describe("recovery after queue data loss", () => {
  it("reconciliation closes out stranded messages honestly, and touches nothing else", async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const insert = (status: "queued" | "sending", queuedAt: Date) =>
      getDb().insert(schema.emailLogs).values({ userId, environment: "production", status, fromAddress: "a@x.com", recipients: ["b@x.com"], subject: "s", queuedAt }).returning().then((r) => r[0]!);

    const lostQueued = await insert("queued", old);
    const lostSending = await insert("sending", old);
    const alive = await insert("queued", old);
    const young = await insert("queued", new Date());
    const q = new Queue(SEND_QUEUE_NAME, { connection: { host: "127.0.0.1", port: redis.port } });
    await q.add("send", { logId: alive.id, userId }, { jobId: `log-${alive.id}`, delay: 60_000 });
    await q.close();

    const dry = await reconcileStrandedLogs({ olderThanMs: 15 * 60 * 1000 });
    expect(dry.stranded.map((s) => s.logId).sort()).toEqual([lostQueued.id, lostSending.id].sort());
    expect(dry.closed).toBe(0);

    const applied = await reconcileStrandedLogs({ olderThanMs: 15 * 60 * 1000, dryRun: false });
    expect(applied.closed).toBe(2);

    const byId = async (id: string) => (await getDb().select().from(schema.emailLogs).where(eq(schema.emailLogs.id, id)))[0]!;
    expect(await byId(lostQueued.id)).toMatchObject({ status: "failed", errorCode: "JOB_LOST", errorMessage: expect.stringMatching(/was not sent/) });
    expect(await byId(lostSending.id)).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(/may or may not have reached SES/) });
    expect((await byId(alive.id)).status).toBe("queued");
    expect((await byId(young.id)).status).toBe("queued");

    // Idempotent.
    expect((await reconcileStrandedLogs({ olderThanMs: 15 * 60 * 1000, dryRun: false })).closed).toBe(0);
    evidence("reconcile_after_queue_loss", { stranded: 2, closed: 2, untouchedAlive: 1, untouchedYoung: 1 });
  });
});

describe("backup and restore drill (PostgreSQL engine)", () => {
  it("a logical backup restores every table, constraint and the RLS lock-down intact", async () => {
    const migrations = resolve(import.meta.dirname, "../../drizzle");
    const source = new PGlite();
    const db = drizzle(source, { schema });
    await migrate(db, { migrationsFolder: migrations });

    const [u] = await db.insert(schema.users).values({ id: crypto.randomUUID(), email: "drill@example.test" }).returning();
    await db.insert(schema.emailLogs).values(Array.from({ length: 50 }, (_, i) => ({ userId: u!.id, environment: "production" as const, status: "sent" as const, fromAddress: "a@x.com", recipients: ["b@x.com"], subject: `m${i}` })));
    await db.insert(schema.suppressionList).values({ userId: u!.id, email: "gone@x.com", reason: "hard_bounce" });

    // Backup.
    const backup = await source.dumpDataDir();
    // Disaster after the backup: data lost.
    await db.delete(schema.users);
    await source.close();

    // Restore into a fresh engine.
    const restored = new PGlite({ loadDataDir: backup });
    const rdb = drizzle(restored, { schema });
    const count = async (table: typeof schema.emailLogs | typeof schema.suppressionList | typeof schema.users) =>
      (await rdb.select().from(table as typeof schema.users)).length;
    expect(await count(schema.users)).toBe(1);
    expect(await count(schema.emailLogs)).toBe(50);
    expect(await count(schema.suppressionList)).toBe(1);

    const rls = await restored.query<{ n: number }>("select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and not c.relrowsecurity");
    expect(rls.rows[0]?.n).toBe(0);
    await expect(rdb.insert(schema.suppressionList).values({ userId: u!.id, email: "gone@x.com", reason: "complaint" })).rejects.toThrow();
    await restored.close();
    evidence("backup_restore_drill", { tablesVerified: 3, rowsRestored: 52, rlsIntact: true, uniqueConstraintsIntact: true });
  });
});
