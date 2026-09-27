import { NextResponse, type NextRequest } from "next/server";

import { ERROR_CODES, errorEnvelope, statusForCode } from "@/lib/api/errors";
import { log } from "@/lib/api/logger";
import { resolveRequestId } from "@/lib/api/request-id";
import { snsEnvelopeSchema } from "@/lib/sns/message";
import { confirmSubscription } from "@/lib/sns/subscription";
import { verifySnsSignature } from "@/lib/sns/verify";
import {
  processNotification,
  recordSubscriptionMessage,
} from "@/server/sns-events";
import { findTopicByArn } from "@/server/sns-topics";

/**
 * POST /api/v1/webhooks/aws-sns — SRS FR-5, §7.
 *
 *   1. Verify SNS signature.
 *   2. Validate TopicArn.
 *   3. Use SNS MessageId as idempotency key.
 *   4. Parse SES notification.
 *   5. Update email_logs.
 *   6. Upsert suppression records for applicable events.
 *   7. Return 2xx after durable processing.
 *
 * Steps 3–6 are one database transaction (`processNotification`). A 2xx is
 * returned only after it commits; any failure returns 5xx and SNS redelivers,
 * which is safe because a redelivery of a committed message is a no-op.
 *
 * Public by necessity — SNS cannot present credentials — so it is excluded
 * from the session middleware along with the rest of `/api/`, and the
 * signature is the authentication.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SNS caps a message at 256 KB; the envelope adds a little. Anything much
 * larger is not from SNS and is refused before it is parsed.
 */
const MAX_BODY_BYTES = 512 * 1024;

function failure(
  code: keyof typeof ERROR_CODES,
  message: string,
  requestId: string,
  status = statusForCode(ERROR_CODES[code]),
): NextResponse {
  return NextResponse.json(
    errorEnvelope(ERROR_CODES[code], message, requestId),
    { status, headers: { "X-Request-Id": requestId } },
  );
}

function ok(requestId: string, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, {
    status: 200,
    headers: { "X-Request-Id": requestId },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return failure("INVALID_REQUEST", "Payload too large.", requestId, 413);
  }

  // SNS posts with `Content-Type: text/plain`, not JSON, so the body is read
  // as text and parsed here rather than trusting the header.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return failure("INVALID_REQUEST", "Payload too large.", requestId, 413);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return failure("INVALID_REQUEST", "Body is not JSON.", requestId);
  }

  const parsed = snsEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    // Also where raw message delivery lands: without the envelope there is no
    // signature, so it cannot be accepted.
    return failure(
      "INVALID_REQUEST",
      "Body is not an SNS message envelope. Raw message delivery must be disabled on the subscription.",
      requestId,
    );
  }

  const envelope = parsed.data;

  // 1. Signature. Nothing below this line runs for an unauthenticated message.
  const verified = await verifySnsSignature(envelope);
  if (!verified.ok && verified.reason === "cert_unavailable") {
    // Our failure, not the sender's: the certificate could not be fetched, so
    // the message is neither verified nor disproven. 503, so SNS retries a
    // genuine event instead of possibly treating a 4xx as final and dropping
    // it. A forged message gains nothing from this — it is still not acted on.
    log.error({
      event: "sns.certificate_unavailable",
      requestId,
      detail: envelope.MessageId,
    });
    return failure(
      "INTERNAL_ERROR",
      "The SNS signing certificate could not be fetched. SNS will retry.",
      requestId,
      503,
    );
  }
  if (!verified.ok) {
    log.warn({
      event: "sns.signature_rejected",
      requestId,
      detail: verified.reason,
    });
    return failure(
      "UNAUTHORIZED",
      "SNS signature verification failed.",
      requestId,
    );
  }

  // 2. Topic. A valid signature proves SNS sent it — not that the topic is one
  // of ours. Unregistered topics are refused, and never confirmed.
  const topic = await findTopicByArn(envelope.TopicArn);
  if (!topic) {
    log.warn({
      event: "sns.unknown_topic",
      requestId,
      detail: envelope.Type,
    });
    return failure(
      "UNAUTHORIZED",
      "This SNS topic is not registered. Add it on the Webhooks page first.",
      requestId,
      403,
    );
  }

  const base = {
    requestId,
    userId: topic.userId,
    detail: envelope.MessageId,
  };

  try {
    if (envelope.Type === "SubscriptionConfirmation") {
      // Confirm first, record second. If the confirmation GET fails we answer
      // 5xx without recording, so SNS's redelivery gets a clean retry.
      const { subscriptionArn } = await confirmSubscription(
        envelope.SubscribeURL,
      );
      await recordSubscriptionMessage(topic, envelope, subscriptionArn);
      log.info({ event: "sns.subscription_confirmed", ...base });
      return ok(requestId, { status: "confirmed" });
    }

    if (envelope.Type === "UnsubscribeConfirmation") {
      // Recorded, deliberately not acted on: re-subscribing after someone
      // unsubscribed in the AWS console would override their decision.
      await recordSubscriptionMessage(topic, envelope, null);
      log.warn({ event: "sns.unsubscribed", ...base });
      return ok(requestId, { status: "unsubscribed" });
    }

    const result = await processNotification(topic, envelope);

    if (result.outcome === "duplicate") {
      log.info({ event: "sns.duplicate_ignored", ...base });
      return ok(requestId, { status: "duplicate" });
    }

    log.info({
      event: "sns.processed",
      ...base,
      logId: result.matchedLogId ?? undefined,
      status: result.eventType ?? "non_ses",
      detail: `${envelope.MessageId} matched=${result.matchedLogId !== null} suppressed=${result.suppressed}`,
      durationMs: Date.now() - startedAt,
    });

    return ok(requestId, {
      status: "processed",
      eventType: result.eventType,
      matched: result.matchedLogId !== null,
      suppressed: result.suppressed,
    });
  } catch (error) {
    // 5xx so SNS redelivers. The transaction rolled back, so a redelivery
    // starts from a clean slate.
    log.error({
      event: "sns.processing_failed",
      ...base,
      detail: error instanceof Error ? error.name : "unknown",
    });
    return failure(
      "INTERNAL_ERROR",
      "The event could not be processed. SNS will retry.",
      requestId,
    );
  }
}
