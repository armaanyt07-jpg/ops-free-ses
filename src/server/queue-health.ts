import "server-only";

import { createRedis, isQueueConfigured } from "@/lib/queue/connection";
import { getSendQueue, jobIdForLog } from "@/lib/queue/send-queue";
import {
  HEARTBEAT_PREFIX,
  HEARTBEAT_TTL_MS,
  type WorkerHeartbeat,
} from "../../worker/heartbeat";

/**
 * Queue and worker monitoring — Phase 2 scope, surfaced on System Health
 * (SRS §12: "Queue depth, retries, failures, webhook lag, worker heartbeat").
 *
 * Webhook lag is tenant data rather than queue state, and lives in
 * `webhookStats` (src/server/sns-events.ts).
 */
export interface QueueDepth {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  /** Whether the queue itself is paused (a queue-level flag, not a count). */
  paused: boolean;
}

export interface WorkerStatus extends WorkerHeartbeat {
  /** Age of the last heartbeat. */
  staleMs: number;
  healthy: boolean;
}

export interface QueueHealth {
  configured: boolean;
  reachable: boolean;
  error: string | null;
  depth: QueueDepth | null;
  workers: WorkerStatus[];
  /** Most recent dead-lettered jobs, newest first. */
  deadLetter: DeadLetterEntry[];
}

export interface DeadLetterEntry {
  jobId: string;
  logId: string | null;
  attemptsMade: number;
  failedReason: string;
  failedAt: Date | null;
}

const EMPTY: QueueHealth = {
  configured: false,
  reachable: false,
  error: null,
  depth: null,
  workers: [],
  deadLetter: [],
};

async function readWorkers(): Promise<WorkerStatus[]> {
  const redis = createRedis("util");

  try {
    // SCAN rather than KEYS: KEYS blocks the server, and this runs on a page
    // render. The set is small, but the habit matters.
    const found: string[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${HEARTBEAT_PREFIX}*`,
        "COUNT",
        100,
      );
      cursor = next;
      found.push(...keys);
    } while (cursor !== "0");

    if (found.length === 0) return [];

    const values = await redis.mget(...found);
    const now = Date.now();

    return values
      .flatMap((raw): WorkerHeartbeat[] => {
        if (!raw) return [];
        try {
          return [JSON.parse(raw) as WorkerHeartbeat];
        } catch {
          return [];
        }
      })
      .map((hb) => {
        const staleMs = now - new Date(hb.beatAt).getTime();
        return { ...hb, staleMs, healthy: staleMs < HEARTBEAT_TTL_MS };
      })
      .sort((a, b) => a.workerId.localeCompare(b.workerId));
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

/**
 * Queue health as one tenant may see it.
 *
 * Depth and worker heartbeats are platform infrastructure and are shown as
 * such. Dead-lettered jobs are **tenant data**: a job carries its tenant's
 * log id, and its failure reason can quote their recipients (SES's "Email
 * address is not verified: …"). They are filtered to `userId`, which is a
 * required argument precisely so no caller can get the unfiltered list by
 * omission. (Until Phase 4 this list was shown unfiltered — a cross-tenant
 * leak in a multi-tenant deployment.)
 */
const DEAD_LETTER_SCAN = 200;

export async function getQueueHealth(userId: string): Promise<QueueHealth> {
  if (!isQueueConfigured()) return EMPTY;

  try {
    const queue = getSendQueue();

    const [counts, paused, workers, failed] = await Promise.all([
      queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
      queue.isPaused(),
      readWorkers(),
      // Scan a wider window than is shown, since other tenants' jobs are
      // filtered out after the read.
      queue.getFailed(0, DEAD_LETTER_SCAN - 1),
    ]);

    return {
      configured: true,
      reachable: true,
      error: null,
      depth: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        paused,
      },
      workers,
      deadLetter: failed
        .filter((job) => (job.data as { userId?: string } | undefined)?.userId === userId)
        .slice(0, 20)
        .map((job) => ({
          jobId: job.id ?? "unknown",
          logId: (job.data as { logId?: string } | undefined)?.logId ?? null,
          attemptsMade: job.attemptsMade,
          failedReason: (job.failedReason ?? "unknown").slice(0, 300),
          failedAt: job.finishedOn ? new Date(job.finishedOn) : null,
        }))
        .sort(
          (a, b) => (b.failedAt?.getTime() ?? 0) - (a.failedAt?.getTime() ?? 0),
        ),
    };
  } catch (error) {
    return {
      ...EMPTY,
      configured: true,
      reachable: false,
      error: error instanceof Error ? error.message : "Unknown Redis error",
    };
  }
}

/**
 * The BullMQ job behind one message, for the message detail page.
 *
 * `null` means Redis has no such job — normal once a completed job is pruned
 * (24 h) — and the email log remains the record. `"unavailable"` means the
 * queue could not be asked. Bounded so a slow Redis cannot stall a page.
 */
export interface SendJobState {
  state: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string | null;
  /** When a delayed job (retry or rate limit) is next due. */
  runsAt: Date | null;
}

export async function getSendJobState(
  userId: string,
  logId: string,
): Promise<SendJobState | null | "unavailable"> {
  if (!isQueueConfigured()) return "unavailable";

  const lookup = (async () => {
    const job = await getSendQueue().getJob(jobIdForLog(logId));
    // Self-scoping (Phase 7): another tenant's job reads as absent, whatever
    // the caller checked beforehand.
    if (!job || (job.data as { userId?: string }).userId !== userId) return null;
    const state = await job.getState();
    return {
      state,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      failedReason: job.failedReason ? job.failedReason.slice(0, 300) : null,
      runsAt:
        state === "delayed" && job.delay
          ? new Date(job.timestamp + job.delay)
          : null,
    } satisfies SendJobState;
  })();

  const timeout = new Promise<"unavailable">((resolve) =>
    setTimeout(() => resolve("unavailable"), 2_000),
  );

  try {
    return await Promise.race([lookup, timeout]);
  } catch {
    return "unavailable";
  }
}
