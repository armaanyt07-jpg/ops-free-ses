import "server-only";

import type { Environment, EmailStatus } from "@/db/schema";
import { ERROR_CODES } from "@/lib/api/errors";
import { log } from "@/lib/api/logger";

import { QueueUnavailableError, enqueueSend } from "./dispatch";
import { createQueuedLog, markFailed } from "./email-logs";
import { findSuppressed } from "./suppression";

/**
 * Message acceptance — SRS §8 steps 2, 4 and 5.
 *
 * Suppression check → durable log → durable enqueue. This is the whole of what
 * a 202 means, and it lives in exactly one place: the public API
 * (`POST /api/v1/send`) and the dashboard's test send both call it, so the two
 * cannot drift apart. Each caller keeps what is genuinely its own —
 * authentication, request parsing, and the shape of its response.
 */
export interface AcceptInput {
  userId: string;
  environment: Environment;
  requestId: string;
  from: string;
  /** Already normalised (deduplicated) by the caller. */
  to: string[];
  subject: string;
  html?: string | undefined;
  text?: string | undefined;
  tags?: Record<string, string> | null | undefined;
  idempotencyKey?: string | null | undefined;
  templateId?: string | null | undefined;
  templateVersion?: number | null | undefined;
}

export type AcceptResult =
  | { ok: true; logId: string; jobId: string }
  | { ok: false; reason: "suppressed"; suppressed: string[] }
  | {
      ok: false;
      reason: "idempotency_conflict";
      logId: string;
      status: EmailStatus;
    }
  | { ok: false; reason: "unavailable" };

export async function acceptSend(input: AcceptInput): Promise<AcceptResult> {
  const { userId, environment, requestId } = input;
  const base = { requestId, userId, environment };

  // Suppression — SRS §8 step 2, §11 "before queue insertion". Checked before
  // the log is written, so a refused message leaves no row and an idempotency
  // key is not consumed by a request that did nothing.
  //
  // The whole message is refused, not just the suppressed addresses: every
  // recipient sees the To list, so silently sending to a subset would deliver
  // a different message from the one the caller asked for.
  let suppressed: string[];
  try {
    suppressed = await findSuppressed(userId, input.to);
  } catch (error) {
    log.error({
      event: "send.suppression_check_failed",
      ...base,
      detail: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, reason: "unavailable" };
  }

  if (suppressed.length > 0) {
    log.info({
      event: "send.recipient_suppressed",
      ...base,
      recipientCount: suppressed.length,
    });
    return { ok: false, reason: "suppressed", suppressed };
  }

  // Persist the log. This commit is what the 202 attests to.
  let created;
  try {
    created = await createQueuedLog({
      userId,
      environment,
      fromAddress: input.from,
      recipients: input.to,
      subject: input.subject,
      idempotencyKey: input.idempotencyKey ?? null,
      tags: input.tags ?? null,
      templateId: input.templateId ?? null,
      templateVersion: input.templateVersion ?? null,
    });
  } catch (error) {
    log.error({
      event: "send.persist_failed",
      ...base,
      detail: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, reason: "unavailable" };
  }

  if (created.outcome === "duplicate") {
    log.info({
      event: "send.idempotency_conflict",
      ...base,
      logId: created.logId,
      status: created.status,
    });
    return {
      ok: false,
      reason: "idempotency_conflict",
      logId: created.logId,
      status: created.status,
    };
  }

  const logId = created.logId;

  // Durably enqueue, before anyone is told "accepted" (SRS §8). Returning
  // success for a job that was never queued would silently drop mail.
  try {
    const { jobId } = await enqueueSend(
      { userId, environment, logId, requestId },
      {
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      },
    );
    return { ok: true, logId, jobId };
  } catch (error) {
    // The log row is already committed. Close it out as failed rather than
    // leaving it stuck in `queued` with no job to drive it.
    await markFailed(logId, {
      errorCode: ERROR_CODES.QUEUE_UNAVAILABLE,
      errorMessage: "The message could not be durably enqueued for delivery.",
      sesRequestId: null,
      retryable: true,
    }).catch(() => undefined);

    log.error({
      event: "send.enqueue_failed",
      ...base,
      logId,
      detail:
        error instanceof QueueUnavailableError && error.cause instanceof Error
          ? error.cause.name
          : "unknown",
    });
    return { ok: false, reason: "unavailable" };
  }
}
