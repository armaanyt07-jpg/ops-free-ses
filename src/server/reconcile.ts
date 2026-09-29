import "server-only";

import { and, inArray, lt } from "drizzle-orm";

import { getDb } from "@/db";
import { emailLogs } from "@/db/schema";
import { getSendQueue, jobIdForLog } from "@/lib/queue/send-queue";

import { markFailed } from "./email-logs";

/**
 * Stranded-message reconciliation — Phase 7 recovery (SRS §17: "reconcile
 * state using idempotent identifiers").
 *
 * A log in `queued` or `sending` is only alive while its BullMQ job exists:
 * the job, not the database, holds the message body. If Redis data is lost
 * (an unrecoverable outage, a restore of Redis from an older snapshot), those
 * logs are stranded — nothing will ever advance them, and they cannot be
 * re-enqueued because the body is gone.
 *
 * This finds them and closes them out *honestly*:
 *   queued  → failed, "not sent — resend it"
 *   sending → failed, "delivery unknown — check before resending"
 *             (the worker may have reached SES before the data was lost)
 *
 * Only logs older than `olderThanMs` are considered, so a job that is being
 * enqueued right now is never mistaken for a lost one. Dry run by default.
 */
export interface ReconcileReport {
  examined: number;
  stranded: Array<{ logId: string; status: string }>;
  closed: number;
  dryRun: boolean;
}

export async function reconcileStrandedLogs({
  olderThanMs = 15 * 60 * 1000,
  dryRun = true,
  limit = 5_000,
}: { olderThanMs?: number; dryRun?: boolean; limit?: number } = {}): Promise<ReconcileReport> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const candidates = await getDb()
    .select({ id: emailLogs.id, status: emailLogs.status })
    .from(emailLogs)
    .where(and(inArray(emailLogs.status, ["queued", "sending"]), lt(emailLogs.queuedAt, cutoff)))
    .limit(limit);

  const queue = getSendQueue();
  const stranded: ReconcileReport["stranded"] = [];
  for (const row of candidates) {
    const job = await queue.getJob(jobIdForLog(row.id));
    if (!job) stranded.push({ logId: row.id, status: row.status });
  }

  let closed = 0;
  if (!dryRun) {
    for (const s of stranded) {
      await markFailed(s.logId, {
        errorCode: "JOB_LOST",
        errorMessage:
          s.status === "sending"
            ? "The queue lost this message while it was being delivered. It may or may not have reached SES — check before resending."
            : "The queue lost this message before delivery. It was not sent — resend it.",
        sesRequestId: null,
        retryable: true,
        terminalReason: "job_lost",
      });
      closed += 1;
    }
  }

  return { examined: candidates.length, stranded, closed, dryRun };
}
