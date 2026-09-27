import { randomUUID } from "node:crypto";

import { Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailLogs, snsEvents, suppressionList } from "@/db/schema";
import type { SendJobData } from "@/lib/queue/send-queue";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Worker integration — the substance of Phase 2.
 *
 * Real Redis, real BullMQ Queue and Worker, real PostgreSQL (PGlite), the real
 * processor and the real credential decryption path. Only AWS is mocked, at
 * the SES client boundary.
 *
 * The retry *policy* (delays, attempt counts) is unit-tested in
 * tests/unit/retry-policy.test.ts. What is verified here is the *mechanism*:
 * that retryable failures actually re-run, permanent ones actually stop, rate
 * limiting actually defers without consuming an attempt, and an abandoned job
 * is actually recovered.
 */
const sendViaSes = vi.hoisted(() => vi.fn());
const describeSesAccount = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ses/client", () => ({
  sendViaSes,
  describeSesAccount,
  createSesClient: vi.fn(),
}));

const { createSendProcessor } = await import("../../worker/processor");
const { storeCredential } = await import("@/server/credentials");

let redis: TestRedis;
let userId: string;
let queue: Queue<SendJobData>;
const workers: Worker[] = [];

const QUEUE = "test-send";

beforeAll(async () => {
  redis = await startTestRedis();
}, 30_000);

beforeEach(async () => {
  vi.clearAllMocks();
  describeSesAccount.mockResolvedValue({
    productionAccessEnabled: true,
    maxSendRate: 50,
    max24HourSend: 50_000,
    sentLast24Hours: 0,
    enforcementStatus: "HEALTHY",
  });
  sendViaSes.mockResolvedValue({ messageId: "ses-msg", requestId: "ses-req" });

  await redis.flush();
  await resetTestDb();
  userId = await createTestUser();

  await storeCredential({
    userId,
    environment: "production",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    awsRegion: "us-east-1",
  });

  queue = new Queue<SendJobData>(QUEUE, {
    connection: { host: "127.0.0.1", port: redis.port },
  });
});

afterAll(async () => {
  await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
  await queue?.close().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

/** Starts a worker with fast backoff so retry mechanics are testable in ms. */
function startWorker(options: { concurrency?: number; lockDuration?: number } = {}) {
  const worker = new Worker<SendJobData>(
    QUEUE,
    createSendProcessor({ redis: redis.client }),
    {
      connection: { host: "127.0.0.1", port: redis.port },
      concurrency: options.concurrency ?? 1,
      lockDuration: options.lockDuration ?? 30_000,
      stalledInterval: 1_000,
      maxStalledCount: 2,
      settings: { backoffStrategy: () => 20 },
    },
  );
  workers.push(worker);
  return worker;
}

async function seedLog(overrides: Partial<SendJobData> = {}): Promise<SendJobData> {
  const [row] = await getDb()
    .insert(emailLogs)
    .values({
      userId,
      environment: "production",
      status: "queued",
      fromAddress: "noreply@example.com",
      recipients: ["alice@example.com"],
      subject: "Hello",
    })
    .returning({ id: emailLogs.id });

  return {
    logId: row!.id,
    userId,
    environment: "production",
    requestId: `req_${randomUUID().slice(0, 8)}`,
    from: "noreply@example.com",
    to: ["alice@example.com"],
    subject: "Hello",
    html: "<h1>Hello</h1>",
    ...overrides,
  };
}

async function logStatus(logId: string) {
  const [row] = await getDb()
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.id, logId));
  return row;
}

/** Polls until `predicate` holds or the deadline passes. */
async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe("successful delivery", () => {
  it("processes a job and drives the log to sent", async () => {
    const data = await seedLog();
    startWorker();
    await queue.add("send", data);

    await waitFor(async () => (await logStatus(data.logId))?.status === "sent");

    const row = await logStatus(data.logId);
    expect(row?.messageId).toBe("ses-msg");
    expect(row?.sesRequestId).toBe("ses-req");
    expect(row?.sentAt).toBeInstanceOf(Date);
    expect(sendViaSes).toHaveBeenCalledOnce();
  });

  it("uses the tenant's own decrypted credential", async () => {
    const data = await seedLog();
    startWorker();
    await queue.add("send", data);
    await waitFor(async () => (await logStatus(data.logId))?.status === "sent");

    expect(sendViaSes.mock.calls[0]![0]).toEqual({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
    });
  });

  it("processes several jobs concurrently", async () => {
    const jobs = await Promise.all([seedLog(), seedLog(), seedLog(), seedLog()]);
    startWorker({ concurrency: 4 });
    await Promise.all(jobs.map((d) => queue.add("send", d)));

    await waitFor(async () => {
      const rows = await Promise.all(jobs.map((j) => logStatus(j.logId)));
      return rows.every((r) => r?.status === "sent");
    });

    expect(sendViaSes).toHaveBeenCalledTimes(4);
  });
});

describe("retryable failures", () => {
  it("retries throttling and succeeds on a later attempt", async () => {
    sendViaSes
      .mockRejectedValueOnce(
        Object.assign(new Error("Maximum sending rate exceeded"), {
          name: "TooManyRequestsException",
          $metadata: { httpStatusCode: 429, requestId: "aws-1" },
        }),
      )
      .mockResolvedValue({ messageId: "ses-msg-2", requestId: "ses-req-2" });

    const data = await seedLog();
    startWorker();
    await queue.add("send", data, { attempts: 3 });

    await waitFor(async () => (await logStatus(data.logId))?.status === "sent");

    expect(sendViaSes).toHaveBeenCalledTimes(2);
    expect((await logStatus(data.logId))?.messageId).toBe("ses-msg-2");
  });

  // While retrying, the message is still live — reporting it as failed would
  // misstate the system's actual state.
  it("holds the log in queued between attempts, not failed", async () => {
    sendViaSes.mockRejectedValue(
      Object.assign(new Error("throttled"), {
        name: "TooManyRequestsException",
        $metadata: { httpStatusCode: 429 },
      }),
    );

    const data = await seedLog();
    startWorker();
    await queue.add("send", data, { attempts: 4, backoff: { type: "fixed", delay: 400 } });

    await waitFor(async () => {
      const row = await logStatus(data.logId);
      return row?.status === "queued" && row.errorCode === "TooManyRequestsException";
    });

    const row = await logStatus(data.logId);
    expect(row?.status).toBe("queued");
    expect(row?.completedAt).toBeNull();
    expect(row?.providerEvent).toMatchObject({ retryable: true });
  });

  it("dead-letters once attempts are exhausted", async () => {
    sendViaSes.mockRejectedValue(
      Object.assign(new Error("throttled"), {
        name: "TooManyRequestsException",
        $metadata: { httpStatusCode: 429 },
      }),
    );

    const data = await seedLog();
    startWorker();
    await queue.add("send", data, { attempts: 3 });

    await waitFor(async () => (await logStatus(data.logId))?.status === "failed");

    const row = await logStatus(data.logId);
    expect(row?.completedAt).toBeInstanceOf(Date);
    expect(row?.providerEvent).toMatchObject({
      retryable: true,
      terminalReason: "attempts_exhausted",
    });
    expect(sendViaSes).toHaveBeenCalledTimes(3);

    // The job lands in the queue's failed set — the dead-letter store.
    await waitFor(async () => (await queue.getJobCounts("failed")).failed === 1);
  });
});

describe("permanent failures", () => {
  it("stops immediately without consuming remaining attempts", async () => {
    sendViaSes.mockRejectedValue(
      Object.assign(new Error("Email address is not verified"), {
        name: "MessageRejected",
        $metadata: { httpStatusCode: 400, requestId: "aws-9" },
      }),
    );

    const data = await seedLog();
    startWorker();
    await queue.add("send", data, { attempts: 5 });

    await waitFor(async () => (await logStatus(data.logId))?.status === "failed");

    const row = await logStatus(data.logId);
    expect(row?.errorCode).toBe("MessageRejected");
    expect(row?.providerEvent).toMatchObject({ terminalReason: "permanent" });

    // The key assertion: SES was called once, not five times. Re-submitting a
    // permanently rejected message would burn quota and reputation.
    await new Promise((r) => setTimeout(r, 300));
    expect(sendViaSes).toHaveBeenCalledOnce();
  });

  it("terminates when no credential is configured, without calling SES", async () => {
    const data = await seedLog({ environment: "staging" });
    await getDb()
      .update(emailLogs)
      .set({ environment: "staging" })
      .where(eq(emailLogs.id, data.logId));

    startWorker();
    await queue.add("send", data, { attempts: 3 });

    await waitFor(async () => (await logStatus(data.logId))?.status === "failed");

    const row = await logStatus(data.logId);
    expect(row?.errorCode).toBe("NO_ACTIVE_CREDENTIAL");
    expect(row?.providerEvent).toMatchObject({ terminalReason: "no_credential" });
    expect(sendViaSes).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  /**
   * Being throttled is not a failed attempt. If deferral consumed one, a
   * tenant on a low SES quota would exhaust its retries purely by waiting its
   * turn — and lose mail it was never allowed to send yet.
   */
  it("defers without consuming a retry attempt", async () => {
    // 1/sec: the second job must wait for a refill.
    await storeCredential({
      userId,
      environment: "production",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      awsRegion: "us-east-1",
    });
    await getDb().execute(
      `UPDATE aws_credentials SET ses_max_send_rate = 1 WHERE user_id = '${userId}'`,
    );

    const a = await seedLog();
    const b = await seedLog();

    startWorker({ concurrency: 2 });
    const jobA = await queue.add("send", a, { attempts: 2 });
    const jobB = await queue.add("send", b, { attempts: 2 });

    await waitFor(async () => {
      const rows = await Promise.all([logStatus(a.logId), logStatus(b.logId)]);
      return rows.every((r) => r?.status === "sent");
    }, 15_000);

    // Both delivered, and neither burned a retry attempt on being throttled.
    for (const id of [jobA.id!, jobB.id!]) {
      const job = await queue.getJob(id);
      expect(job?.attemptsMade).toBeLessThanOrEqual(1);
    }
    expect(sendViaSes).toHaveBeenCalledTimes(2);
  }, 30_000);
});

describe("durability", () => {
  /**
   * Exit criterion: "Worker failure does not silently lose accepted jobs."
   *
   * A worker is killed mid-job by closing it without waiting for the job to
   * finish. BullMQ's stalled-job detection must return the orphan to the queue
   * so a second worker picks it up.
   */
  it("recovers a job abandoned by a dead worker", async () => {
    let releaseFirstAttempt: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseFirstAttempt = resolve;
    });

    let attempts = 0;
    sendViaSes.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) {
        // Hang the first attempt so the worker can be killed mid-flight.
        await held;
        throw new Error("worker died before this resolved");
      }
      return { messageId: "recovered", requestId: "ses-req-r" };
    });

    const data = await seedLog();
    const doomed = startWorker({ lockDuration: 2_000 });
    const job = await queue.add("send", data, { attempts: 3 });

    // Wait until the job is actually in flight.
    await waitFor(async () => (await queue.getJobCounts("active")).active === 1);

    // Kill the worker without letting it finish or release the lock.
    await doomed.close(true);
    releaseFirstAttempt?.();

    // A second worker must pick the orphan up once the lock expires.
    startWorker();

    await waitFor(
      async () => (await logStatus(data.logId))?.status === "sent",
      25_000,
    );

    const row = await logStatus(data.logId);
    expect(row?.messageId).toBe("recovered");

    const finished = await queue.getJob(job.id!);
    expect(finished).toBeDefined();
  }, 40_000);
});

describe("suppression before submission (Phase 3)", () => {
  it("does not call SES for a recipient suppressed after acceptance", async () => {
    const data = await seedLog();
    // A hard bounce landed while the job was waiting in the queue.
    await getDb()
      .insert(suppressionList)
      .values({ userId, email: "alice@example.com", reason: "hard_bounce" });

    startWorker();
    const job = await queue.add("send", data);

    await waitFor(async () => (await logStatus(data.logId))?.status === "suppressed");

    expect(sendViaSes).not.toHaveBeenCalled();
    const row = await logStatus(data.logId);
    expect(row?.errorCode).toBe("RECIPIENT_SUPPRESSED");
    expect(row?.completedAt).toBeInstanceOf(Date);

    // Completed, not failed: nothing went wrong, and it must not dead-letter
    // or be retried.
    await waitFor(async () => (await queue.getJob(job.id!))?.finishedOn !== undefined);
    expect(await (await queue.getJob(job.id!))?.getState()).toBe("completed");
  });

  it("still delivers when the suppression is inactive", async () => {
    const data = await seedLog();
    await getDb()
      .insert(suppressionList)
      .values({ userId, email: "alice@example.com", reason: "hard_bounce", active: false });

    startWorker();
    await queue.add("send", data);
    await waitFor(async () => (await logStatus(data.logId))?.status === "sent");
    expect(sendViaSes).toHaveBeenCalledOnce();
  });
});

describe("SNS reconciliation after send (Phase 3)", () => {
  it("applies an event that arrived before the message id was recorded", async () => {
    const data = await seedLog();
    // The delivery event beat markSent: stored unmatched for this SES id.
    await getDb().insert(snsEvents).values({
      messageId: randomUUID(),
      userId,
      topicArn: "arn:aws:sns:us-east-1:123456789012:t",
      messageType: "Notification",
      eventType: "Delivery",
      sesMessageId: "ses-msg",
      eventAt: new Date(),
      payload: { recipients: ["alice@example.com"], processingTimeMillis: 10 },
    });

    startWorker();
    await queue.add("send", data);

    await waitFor(async () => (await logStatus(data.logId))?.status === "delivered");
    expect(sendViaSes).toHaveBeenCalledOnce();
  });
});
