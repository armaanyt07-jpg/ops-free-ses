import "server-only";

import type { Environment } from "@/db/schema";
import { getSendQueue, jobIdForLog, type SendJobData } from "@/lib/queue/send-queue";

/**
 * Delivery dispatch — the API's handoff to the delivery plane.
 *
 * Phase 2 replaced the Phase 1 in-process SES call with a durable BullMQ
 * enqueue. The SES call now lives in the worker (`worker/index.ts`).
 *
 * This runs *inside* the request, before the 202 is returned, which is what
 * makes SRS §8's "API acceptance is durable queue acceptance" true: the
 * response is only sent once Redis has acknowledged the job. A failure here is
 * therefore a failure of the request, not a background problem — the caller
 * gets 503 QUEUE_UNAVAILABLE and can retry.
 */
export interface DeliveryContext {
  userId: string;
  environment: Environment;
  logId: string;
  requestId: string;
}

export interface DeliveryPayload {
  from: string;
  to: string[];
  subject: string;
  html: string | undefined;
  text: string | undefined;
}

export class QueueUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Could not durably enqueue the message");
    this.name = "QueueUnavailableError";
    this.cause = cause;
  }
}

/**
 * Hard ceiling on how long a request will wait for the queue.
 *
 * Bounded retries on the producer connection make a hang unlikely; this makes
 * it impossible. An HTTP request must terminate in a predictable time whatever
 * Redis is doing, so the caller gets a 503 it can act on rather than a socket
 * that never answers.
 */
const ENQUEUE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Enqueue timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Enqueues a send job.
 *
 * Throws `QueueUnavailableError` if Redis does not accept the job. The caller
 * must not return 202 in that case: the SRS is explicit that a 202 means the
 * job is durably held, and returning one for a job that was never queued would
 * silently drop mail.
 */
export async function enqueueSend(
  context: DeliveryContext,
  payload: DeliveryPayload,
): Promise<{ jobId: string }> {
  const data: SendJobData = {
    logId: context.logId,
    userId: context.userId,
    environment: context.environment,
    requestId: context.requestId,
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  };

  try {
    const job = await withTimeout(
      getSendQueue().add("send", data, {
        // Keyed by the log id, so a duplicate enqueue for the same accepted
        // request cannot create a second delivery.
        jobId: jobIdForLog(context.logId),
      }),
      ENQUEUE_TIMEOUT_MS,
    );

    return { jobId: job.id ?? jobIdForLog(context.logId) };
  } catch (error) {
    throw new QueueUnavailableError(error);
  }
}
