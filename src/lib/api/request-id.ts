import { randomBytes } from "node:crypto";

/**
 * Correlation IDs (SRS §14: "Every request receives a correlation/request ID").
 *
 * An inbound `X-Request-Id` is honoured so a caller can stitch their traces to
 * ours, but it is length-capped and character-filtered first — it reaches logs
 * and response bodies, and must not be a log-injection vector.
 */
const MAX_INBOUND_LENGTH = 80;
const SAFE_ID = /^[A-Za-z0-9_.:-]+$/;

export function newRequestId(): string {
  return `req_${randomBytes(12).toString("hex")}`;
}

export function resolveRequestId(inbound: string | null): string {
  if (!inbound) return newRequestId();

  const trimmed = inbound.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INBOUND_LENGTH) {
    return newRequestId();
  }
  if (!SAFE_ID.test(trimmed)) return newRequestId();

  return trimmed;
}
