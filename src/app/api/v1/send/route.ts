import { NextResponse, after, type NextRequest } from "next/server";

import { ERROR_CODES, errorEnvelope, statusForCode } from "@/lib/api/errors";
import { log } from "@/lib/api/logger";
import { rateLimited, withErrorBoundary, readBoundedBody } from "@/lib/api/http";
import {
  idempotencyKeySchema,
  normaliseRecipients,
  sendRequestSchema,
} from "@/lib/api/send-schema";
import { parseBearerToken } from "@/lib/crypto/api-key";
import { authenticateApiKey, touchApiKey } from "@/server/api-keys";
import { renderInline } from "@/lib/templates/engine";
import { checkLimit, clientIp } from "@/server/abuse";
import { acceptSend } from "@/server/send-service";
import { renderTemplateForSend } from "@/server/templates";

/**
 * POST /api/v1/send — SRS FR-3 / §7.
 *
 * Node runtime: the request path uses node:crypto and a TCP PostgreSQL driver.
 * Never statically cached.
 */
export const runtime = "nodejs";

/** SES accepts far larger messages; this bounds what one request can buffer. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const dynamic = "force-dynamic";

function failure(
  code: keyof typeof ERROR_CODES,
  message: string,
  requestId: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    errorEnvelope(ERROR_CODES[code], message, requestId, details),
    {
      status: statusForCode(ERROR_CODES[code]),
      headers: { "X-Request-Id": requestId },
    },
  );
}

export const POST = withErrorBoundary("send", handle);

async function handle(request: NextRequest, requestId: string): Promise<NextResponse> {
  const startedAt = Date.now();

  // 0. Per-IP limit, before any database work: a flood of junk keys must not
  // become a flood of key lookups (Phase 7).
  const ipLimit = await checkLimit("ip", clientIp(request.headers), requestId);
  if (!ipLimit.allowed) {
    log.warn({ event: "send.rate_limited", requestId, detail: "ip" });
    return rateLimited(requestId, ipLimit.retryAfterMs);
  }

  // 1. Authenticate. The raw header is never logged (SRS §9).
  const presented = parseBearerToken(request.headers.get("authorization"));
  if (!presented) {
    log.warn({
      event: "send.unauthorized",
      requestId,
      detail: "missing_or_malformed_authorization_header",
    });
    return failure(
      "UNAUTHORIZED",
      "A valid API key must be supplied as `Authorization: Bearer <key>`.",
      requestId,
    );
  }

  const auth = await authenticateApiKey(presented);
  if (!auth.ok) {
    // The reason is recorded for operators but never disclosed to the caller,
    // so probing cannot distinguish an unknown key from a revoked one.
    log.warn({
      event: "send.unauthorized",
      requestId,
      detail: auth.reason,
    });
    return failure(
      "UNAUTHORIZED",
      "The supplied API key is invalid, revoked or expired.",
      requestId,
    );
  }

  const { userId, environment, keyId } = auth.key;

  // 1b. Per-key limit — SRS §7 "429 application rate limit exceeded".
  const keyLimit = await checkLimit("apiKey", keyId, requestId);
  if (!keyLimit.allowed) {
    log.warn({ event: "send.rate_limited", requestId, userId, environment, apiKeyId: keyId, detail: "api_key" });
    return rateLimited(requestId, keyLimit.retryAfterMs);
  }

  // 2. Validate the body against the published contract. The body is read
  // with a hard ceiling; `request.json()` has none.
  const body_ = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!body_.ok) {
    return NextResponse.json(
      errorEnvelope(ERROR_CODES.INVALID_REQUEST, `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024} MB.`, requestId),
      { status: 413, headers: { "X-Request-Id": requestId } },
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body_.text);
  } catch {
    return failure(
      "INVALID_REQUEST",
      "Request body must be valid JSON.",
      requestId,
    );
  }

  const parsed = sendRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(
      "INVALID_REQUEST",
      "The request body failed validation.",
      requestId,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const body = parsed.data;

  // 3. Resolve the optional idempotency key.
  const rawIdempotencyKey = request.headers.get("idempotency-key");
  let idempotencyKey: string | null = null;
  if (rawIdempotencyKey !== null) {
    const key = idempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!key.success) {
      return failure(
        "INVALID_REQUEST",
        "`Idempotency-Key` must be between 1 and 255 characters.",
        requestId,
      );
    }
    idempotencyKey = key.data;
  }

  const recipients = normaliseRecipients(body.to);

  // 3b. Resolve and render the content — SRS §8 step 3, before anything is
  // written, so a bad template or missing variable is a 400 with reasons
  // rather than an accepted message that fails later.
  let content: {
    subject: string;
    html: string | undefined;
    text: string | undefined;
    templateId: string | null;
    templateVersion: number | null;
  };

  if (body.templateId !== undefined) {
    const resolved = await renderTemplateForSend(userId, body.templateId, body.variables);
    if (!resolved.ok) {
      return failure(
        "INVALID_REQUEST",
        resolved.message,
        requestId,
        resolved.reason === "invalid_variables" ? { variables: resolved.errors } : undefined,
      );
    }
    content = {
      subject: resolved.rendered.subject,
      html: resolved.rendered.html,
      text: resolved.rendered.text,
      templateId: resolved.templateId,
      templateVersion: resolved.version,
    };
  } else if (body.variables !== undefined) {
    const rendered = renderInline(
      { subject: body.subject!, html: body.html, text: body.text },
      body.variables,
    );
    if (!rendered.ok) {
      return failure("INVALID_REQUEST", "The template variables are invalid.", requestId, {
        variables: rendered.errors,
      });
    }
    content = { ...rendered, templateId: null, templateVersion: null };
  } else {
    // No variables: inline content is sent exactly as given, as before.
    content = {
      subject: body.subject!,
      html: body.html,
      text: body.text,
      templateId: null,
      templateVersion: null,
    };
  }

  // 4–6. Suppression, durable log, durable enqueue — shared with the
  // dashboard's test send (src/server/send-service.ts).
  const accepted = await acceptSend({
    userId,
    environment,
    requestId,
    from: body.from,
    to: recipients,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: body.tags ?? null,
    idempotencyKey,
    templateId: content.templateId,
    templateVersion: content.templateVersion,
  });

  if (!accepted.ok) {
    switch (accepted.reason) {
      case "suppressed":
        return failure(
          "RECIPIENT_SUPPRESSED",
          "One or more recipients are on the suppression list. Remove them and retry.",
          requestId,
          { suppressed: accepted.suppressed },
        );
      case "idempotency_conflict":
        return NextResponse.json(
          errorEnvelope(
            ERROR_CODES.INVALID_REQUEST,
            "This idempotency key has already been used.",
            requestId,
            { id: accepted.logId, status: accepted.status },
          ),
          // 409 per the SRS §7 error list, which overrides this code's
          // default status: the request was well-formed, it conflicts with
          // existing state.
          { status: 409, headers: { "X-Request-Id": requestId } },
        );
      case "unavailable":
        return failure(
          "QUEUE_UNAVAILABLE",
          "The message could not be durably accepted. Retry shortly.",
          requestId,
        );
    }
  }

  const { logId, jobId } = accepted;

  // Usage bookkeeping is the only work left that the caller need not wait for.
  after(async () => {
    await touchApiKey(keyId).catch(() => undefined);
  });

  log.info({
    event: "send.accepted",
    requestId,
    userId,
    environment,
    logId,
    jobId,
    apiKeyId: keyId,
    status: "queued",
    recipientCount: recipients.length,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(
    {
      id: logId,
      status: "queued",
      message: "Accepted for asynchronous delivery",
    },
    { status: 202, headers: { "X-Request-Id": requestId } },
  );
}
