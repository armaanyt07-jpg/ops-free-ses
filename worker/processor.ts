import {
  DelayedError,
  UnrecoverableError,
  type Job,
} from "bullmq";
import type { Redis } from "ioredis";

import { log } from "@/lib/api/logger";
import { DecryptionError } from "@/lib/crypto/encryption";
import { acquireSendToken } from "@/lib/queue/rate-limiter";
import { backoffDelayMs, MAX_ATTEMPTS } from "@/lib/queue/retry-policy";
import type { SendJobData } from "@/lib/queue/send-queue";
import { sendViaSes } from "@/lib/ses/client";
import { classifySesError } from "@/lib/ses/errors";
import { loadDeliveryCredential } from "@/server/credentials";
import {
  markFailed,
  markRetrying,
  markSending,
  markSent,
  markSuppressed,
} from "@/server/email-logs";
import { reconcileEventsForLog } from "@/server/sns-events";
import { findSuppressed } from "@/server/suppression";

/**
 * The delivery processor.
 *
 * Separated from `worker/index.ts` so it can be driven by tests against a real
 * queue without the process wiring (signal handlers, heartbeat, `process.exit`)
 * coming along with it.
 *
 * Three distinct outcomes, and the difference between them is the substance of
 * this phase:
 *
 *   - rate limited → re-delayed WITHOUT consuming an attempt
 *   - retryable    → throws; BullMQ re-schedules with exponential backoff
 *   - permanent    → `UnrecoverableError`; no further attempts
 */
export interface ProcessorDeps {
  /** Connection used for the token bucket. Separate from the worker's own. */
  redis: Redis;
}

export type SendProcessor = (
  job: Job<SendJobData>,
  token?: string,
) => Promise<void>;

export function createSendProcessor({ redis }: ProcessorDeps): SendProcessor {
  return async function processSendJob(job, token) {
    const { logId, userId, environment, requestId } = job.data;
    const attempt = job.attemptsMade + 1;

    const base = {
      requestId,
      userId,
      environment,
      logId,
      jobId: job.id,
      attempt,
    };

    // SES already accepted this message on an earlier attempt, and only the
    // bookkeeping failed (e.g. the database was down). Finish that; never call
    // SES again — that would deliver the email twice.
    if (job.data.acceptedBySes) {
      const accepted = job.data.acceptedBySes;
      await markSent(logId, { messageId: accepted.messageId, sesRequestId: accepted.requestId });
      log.info({ event: "worker.sent", ...base, status: "sent", detail: "bookkeeping_retry_no_resend" });
      await reconcileAfterSend(userId, accepted.messageId);
      return;
    }

    let credential;
    try {
      credential = await loadDeliveryCredential(userId, environment);
    } catch (error) {
      if (!(error instanceof DecryptionError)) throw error;

      await markFailed(logId, {
        errorCode: "CREDENTIAL_DECRYPTION_FAILED",
        errorMessage:
          "The stored AWS credential could not be decrypted. Re-enter it for this environment.",
        sesRequestId: null,
        retryable: false,
        terminalReason: "permanent",
        attempt,
      });
      log.error({ event: "worker.credential_undecryptable", ...base });
      throw new UnrecoverableError("Credential could not be decrypted");
    }

    if (!credential) {
      await markFailed(logId, {
        errorCode: "NO_ACTIVE_CREDENTIAL",
        errorMessage: `No active AWS credential is configured for the ${environment} environment`,
        sesRequestId: null,
        retryable: false,
        terminalReason: "no_credential",
        attempt,
      });
      log.error({ event: "worker.no_credential", ...base });
      throw new UnrecoverableError("No active AWS credential");
    }

    // Suppression, second check — SRS §11 "immediately before provider
    // submission". The API checked at acceptance, but a bounce or complaint
    // can land while this job waits in the queue. Checked before the rate
    // gate so a message that will not be sent never spends a token; a job
    // deferred by the gate re-runs this whole function, so the check is
    // repeated on every pass that could reach SES.
    const suppressed = await findSuppressed(userId, job.data.to);
    if (suppressed.length > 0) {
      await markSuppressed(logId, suppressed);
      log.info({
        event: "worker.suppressed",
        ...base,
        status: "suppressed",
        recipientCount: suppressed.length,
      });
      // Completes the job: nothing failed, the message is deliberately unsent.
      return;
    }

    // Rate limit gate — SRS FR-4. Checked immediately before the provider call
    // so a token is never held across a slow operation.
    const decision = await acquireSendToken(
      redis,
      userId,
      environment,
      credential.maxSendRate,
    );

    if (!decision.allowed) {
      log.info({
        event: "worker.rate_limited",
        ...base,
        detail: `retry_after_ms=${decision.retryAfterMs}`,
      });

      // Re-delay THIS job only. BullMQ's worker-level limiter would stall
      // every tenant's jobs on this worker, not just this tenant's.
      // `DelayedError` marks the job as deliberately deferred, so the attempt
      // counter is untouched — being throttled is not a failed attempt.
      await job.moveToDelayed(Date.now() + decision.retryAfterMs, token);
      throw new DelayedError();
    }

    await markSending(logId);

    // Only the SES call is inside this try. A failure *after* SES accepted the
    // message is not an SES failure, and must never be retried as a send.
    let result: Awaited<ReturnType<typeof sendViaSes>>;
    try {
      result = await sendViaSes(credential.credentials, {
        from: job.data.from,
        to: job.data.to,
        subject: job.data.subject,
        html: job.data.html,
        text: job.data.text,
      });
    } catch (error) {
      const classified = classifySesError(error);
      const isLastAttempt = attempt >= (job.opts.attempts ?? MAX_ATTEMPTS);

      if (!classified.retryable) {
        await markFailed(logId, {
          errorCode: classified.providerCode,
          errorMessage: classified.message,
          sesRequestId: classified.requestId,
          retryable: false,
          terminalReason: "permanent",
          attempt,
        });
        log.warn({
          event: "worker.permanent_failure",
          ...base,
          status: "failed",
          errorCode: classified.providerCode,
        });
        // Re-submitting a message SES has permanently rejected would burn
        // quota and reputation for no chance of success.
        throw new UnrecoverableError(classified.message);
      }

      if (isLastAttempt) {
        await markFailed(logId, {
          errorCode: classified.providerCode,
          errorMessage: classified.message,
          sesRequestId: classified.requestId,
          retryable: true,
          terminalReason: "attempts_exhausted",
          attempt,
        });
        log.error({
          event: "worker.dead_lettered",
          ...base,
          status: "failed",
          errorCode: classified.providerCode,
        });
        throw error;
      }

      await markRetrying(logId, {
        errorCode: classified.providerCode,
        errorMessage: classified.message,
        sesRequestId: classified.requestId,
        attempt,
        nextAttemptAt: new Date(Date.now() + backoffDelayMs(attempt)),
      });

      log.warn({
        event: "worker.retryable_failure",
        ...base,
        status: "queued",
        errorCode: classified.providerCode,
      });
      throw error;
    }

    // SES has accepted the message. Record that on the job (in Redis) before
    // anything else can fail, so a retry finishes the bookkeeping instead of
    // sending again. If even this write fails we carry on: the remaining
    // duplicate window is the milliseconds between SES answering and here.
    await job
      .updateData({
        ...job.data,
        acceptedBySes: { messageId: result.messageId, requestId: result.requestId, at: new Date().toISOString() },
      })
      .catch((error: unknown) => {
        log.warn({ event: "worker.accept_record_failed", ...base, detail: error instanceof Error ? error.name : "unknown" });
      });

    // If this throws (database down), BullMQ retries; the retry takes the
    // acceptedBySes path above and does not call SES.
    await markSent(logId, { messageId: result.messageId, sesRequestId: result.requestId });

    log.info({
      event: "worker.sent",
      ...base,
      status: "sent",
      recipientCount: job.data.to.length,
    });

    await reconcileAfterSend(userId, result.messageId);
  };

  /**
   * Apply any SNS event that raced ahead of `markSent` (see
   * `reconcileEventsForLog`). Never allowed to throw: SES has accepted the
   * message, and an error escaping here would make BullMQ retry the job.
   */
  async function reconcileAfterSend(userId: string, messageId: string | null): Promise<void> {
    if (!messageId) return;
    await reconcileEventsForLog(userId, messageId).catch((error: unknown) => {
      log.warn({
        event: "worker.reconcile_failed",
        requestId: "worker",
        detail: error instanceof Error ? error.name : "unknown",
      });
    });
  }
}
