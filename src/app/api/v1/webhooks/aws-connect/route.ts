import { NextResponse, type NextRequest } from "next/server";

import { ERROR_CODES, errorEnvelope, statusForCode } from "@/lib/api/errors";
import { log } from "@/lib/api/logger";
import { rateLimited, withErrorBoundary, readBoundedBody } from "@/lib/api/http";
import {
  buildResponse,
  customResourceSchema,
  isTrustedResponseUrl,
  putResponse,
} from "@/lib/aws/connect";
import { platformAws } from "@/lib/aws/platform";
import { snsEnvelopeSchema } from "@/lib/sns/message";
import { confirmSubscription } from "@/lib/sns/subscription";
import { verifySnsSignature } from "@/lib/sns/verify";
import { checkLimit, clientIp } from "@/server/abuse";
import { handleConnectCallback } from "@/server/aws-connect";

/**
 * POST /api/v1/webhooks/aws-connect — Phase 10, one-click "Connect AWS".
 *
 * The CloudFormation stack a customer launches contains a custom resource whose
 * ServiceToken is our SNS topic. CloudFormation publishes its request there;
 * SNS delivers it here; we answer by PUTting to the presigned URL inside it.
 *
 * Authenticity is the SNS signature plus an exact match on OUR topic ARN (this
 * topic's policy must let any account publish, because customers' stacks do).
 * The message is still only a hint: the role is proven later by assuming it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;

function failure(
  code: keyof typeof ERROR_CODES,
  message: string,
  requestId: string,
  status = statusForCode(ERROR_CODES[code]),
): NextResponse {
  return NextResponse.json(errorEnvelope(ERROR_CODES[code], message, requestId), {
    status,
    headers: { "X-Request-Id": requestId },
  });
}

function ok(requestId: string, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "X-Request-Id": requestId } });
}

export const POST = withErrorBoundary("webhooks.aws-connect", handle);

async function handle(request: NextRequest, requestId: string): Promise<NextResponse> {
  const platform = platformAws();
  if (!platform) return failure("INVALID_REQUEST", "One-click connect is not configured.", requestId, 404);

  const ipLimit = await checkLimit("webhookIp", clientIp(request.headers), requestId);
  if (!ipLimit.allowed) return rateLimited(requestId, ipLimit.retryAfterMs);

  const body = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!body.ok) return failure("INVALID_REQUEST", "Payload too large.", requestId, 413);

  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return failure("INVALID_REQUEST", "Body is not JSON.", requestId);
  }

  const parsed = snsEnvelopeSchema.safeParse(json);
  if (!parsed.success) return failure("INVALID_REQUEST", "Body is not an SNS message envelope.", requestId);
  const envelope = parsed.data;

  const verified = await verifySnsSignature(envelope);
  if (!verified.ok && verified.reason === "cert_unavailable") {
    log.error({ event: "sns.certificate_unavailable", requestId, detail: envelope.MessageId });
    return failure("INTERNAL_ERROR", "The SNS signing certificate could not be fetched. SNS will retry.", requestId, 503);
  }
  if (!verified.ok) {
    log.warn({ event: "sns.signature_rejected", requestId, detail: verified.reason });
    return failure("UNAUTHORIZED", "SNS signature verification failed.", requestId);
  }

  // A valid signature proves SNS sent it, not that it is OUR topic.
  if (envelope.TopicArn !== platform.topicArn) {
    log.warn({ event: "sns.unknown_topic", requestId, detail: "aws-connect" });
    return failure("UNAUTHORIZED", "Unexpected topic.", requestId, 403);
  }

  try {
    if (envelope.Type === "SubscriptionConfirmation") {
      await confirmSubscription(envelope.SubscribeURL);
      log.info({ event: "sns.subscription_confirmed", requestId, detail: "aws-connect" });
      return ok(requestId, { status: "confirmed" });
    }
    if (envelope.Type === "UnsubscribeConfirmation") {
      log.warn({ event: "sns.unsubscribed", requestId, detail: "aws-connect" });
      return ok(requestId, { status: "unsubscribed" });
    }

    let message: unknown;
    try {
      message = JSON.parse(envelope.Message);
    } catch {
      return failure("INVALID_REQUEST", "Message is not a CloudFormation request.", requestId);
    }
    const request_ = customResourceSchema.safeParse(message);
    if (!request_.success) {
      return failure("INVALID_REQUEST", "Message is not a CloudFormation custom-resource request.", requestId);
    }
    const req = request_.data;
    // The URL arrives in a body we only just authenticated; still never PUT to
    // anywhere but an AWS response bucket.
    if (!isTrustedResponseUrl(req.ResponseURL)) {
      log.warn({ event: "aws_connect.untrusted_response_url", requestId });
      return failure("INVALID_REQUEST", "Untrusted response URL.", requestId);
    }

    const outcome = await handleConnectCallback(req);
    const response = buildResponse(req, outcome.status, outcome.status === "FAILED" ? outcome.reason : undefined);
    await putResponse(req.ResponseURL, JSON.stringify(response));

    log.info({ event: "aws_connect.answered", requestId, status: outcome.status, detail: req.RequestType });
    return ok(requestId, { status: "answered", result: outcome.status });
  } catch (error) {
    // 5xx so SNS redelivers; the handler is idempotent.
    log.error({
      event: "aws_connect.failed",
      requestId,
      detail: error instanceof Error ? error.name : "unknown",
    });
    return failure("INTERNAL_ERROR", "The request could not be processed. SNS will retry.", requestId);
  }
}
