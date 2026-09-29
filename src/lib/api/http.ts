import { NextResponse, type NextRequest } from "next/server";

import { reportError } from "@/lib/observability/errors";

import { ERROR_CODES, errorEnvelope } from "./errors";
import { resolveRequestId } from "./request-id";

/**
 * Small HTTP helpers shared by the public API routes (Phase 7 hardening).
 */

/** 429 with `Retry-After` in whole seconds, as HTTP requires. */
export function rateLimited(requestId: string, retryAfterMs: number, message?: string): NextResponse {
  return NextResponse.json(
    errorEnvelope(ERROR_CODES.RATE_LIMITED, message ?? "Too many requests. Retry after the delay in the Retry-After header.", requestId),
    {
      status: 429,
      headers: {
        "X-Request-Id": requestId,
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
      },
    },
  );
}

export type BoundedBody = { ok: true; text: string } | { ok: false; reason: "too_large" };

/**
 * Reads a request body with a hard byte ceiling. `request.json()` has no limit
 * at all: a single request could buffer arbitrarily large input into memory
 * and, for /send, into Redis. The declared Content-Length is checked first
 * (cheap), then the stream is counted as it is read (Content-Length can lie or
 * be absent with chunked encoding).
 */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<BoundedBody> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too_large" };
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  return { ok: true, text: new TextDecoder().decode(Buffer.concat(chunks)) };
}

/**
 * Top-level error boundary for public API routes (Phase 7).
 *
 * Without it, an unexpected exception — the database down during
 * authentication, say — escapes to the framework's bare 500: no JSON envelope,
 * no request id for the caller to quote, an unstructured stack in the logs.
 * With it, the caller always gets the SRS §14 envelope and the error is
 * reported once, structured and fingerprinted.
 */
export function withErrorBoundary(
  route: string,
  handler: (request: NextRequest, requestId: string) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request) => {
    const requestId = resolveRequestId(request.headers.get("x-request-id"));
    try {
      return await handler(request, requestId);
    } catch (error) {
      reportError(error, { source: "route", route, requestId });
      return NextResponse.json(
        errorEnvelope(ERROR_CODES.INTERNAL_ERROR, "An unexpected error occurred. Retry shortly; quote the request id if it persists.", requestId),
        { status: 500, headers: { "X-Request-Id": requestId } },
      );
    }
  };
}
