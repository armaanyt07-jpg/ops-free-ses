import { Queue, type JobsOptions } from "bullmq";

import type { Environment } from "@/db/schema";
import { createRedis } from "./connection";
import { COMPLETED_JOB_RETENTION_HOURS, FAILED_JOB_RETENTION_DAYS } from "./retention";
import { MAX_ATTEMPTS } from "./retry-policy";

/**
 * The send queue — SRS FR-4.
 *
 * One queue serves every tenant. Per-tenant fairness and SES rate limits are
 * enforced by the worker's token bucket rather than by queue partitioning,
 * because a queue per tenant would multiply Redis connections and BullMQ
 * maintenance traffic without bounding either.
 */
export const SEND_QUEUE_NAME = "ses-send";

/**
 * Job payload.
 *
 * Deliberately carries the full message rather than only the log id. The
 * worker would otherwise have to re-read the row, which turns every delivery
 * into an extra database round trip and makes the queue depend on the
 * database being reachable at delivery time.
 *
 * `requestId` is the correlation id minted by the API. Carrying it into the
 * job lets a single id follow a message from HTTP request through worker
 * attempt to SES call.
 */
export interface SendJobData {
  logId: string;
  userId: string;
  environment: Environment;
  requestId: string;
  from: string;
  to: string[];
  subject: string;
  html?: string | undefined;
  text?: string | undefined;
  /**
   * Set by the worker the moment SES accepts the message (Phase 7). A retry
   * that finds it skips SES entirely and only finishes the bookkeeping — so a
   * database failure after a successful send can never send the email twice.
   */
  acceptedBySes?: { messageId: string | null; requestId: string | null; at: string } | undefined;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: MAX_ATTEMPTS,
  // A custom strategy registered on the Worker computes the actual delay; the
  // type only selects which strategy to invoke.
  backoff: { type: "ses" },
  // Completed jobs are pruned: the email log is the durable record, so keeping
  // them in Redis would duplicate state and grow without bound.
  removeOnComplete: { count: 1_000, age: COMPLETED_JOB_RETENTION_HOURS * 3600 },
  // Failed jobs are NOT pruned aggressively — the failed set is the
  // dead-letter store (see docs/PHASE-2.md).
  removeOnFail: { count: 10_000, age: FAILED_JOB_RETENTION_DAYS * 24 * 3600 },
};

let queue: Queue<SendJobData> | undefined;

export function getSendQueue(): Queue<SendJobData> {
  if (!queue) {
    queue = new Queue<SendJobData>(SEND_QUEUE_NAME, {
      connection: createRedis("queue"),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return queue;
}

/**
 * The job id is the email log id.
 *
 * BullMQ treats `jobId` as a uniqueness key, so a retried API call that
 * resolves to the same log row can never produce a second delivery. This is
 * the queue-level half of the idempotency guarantee; the database unique index
 * on `(user_id, idempotency_key)` is the other half.
 */
export function jobIdForLog(logId: string): string {
  // Hyphen, not colon: BullMQ rejects a custom job id containing ':' because
  // it uses that character as its own Redis key separator.
  return `log-${logId}`;
}

export async function closeSendQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
