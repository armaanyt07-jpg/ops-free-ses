/**
 * Error model — SRS §14.
 *
 * The code set is closed: these are exactly the codes the SRS defines. New
 * failure shapes are mapped onto an existing code rather than inventing one,
 * so the public API contract stays stable across phases.
 */
export const ERROR_CODES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  DOMAIN_NOT_VERIFIED: "DOMAIN_NOT_VERIFIED",
  RECIPIENT_SUPPRESSED: "RECIPIENT_SUPPRESSED",
  SES_THROTTLED: "SES_THROTTLED",
  SES_REJECTED: "SES_REJECTED",
  QUEUE_UNAVAILABLE: "QUEUE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** HTTP status for each code, per the SRS §7 error list. */
const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  DOMAIN_NOT_VERIFIED: 403,
  RECIPIENT_SUPPRESSED: 403,
  SES_THROTTLED: 429,
  SES_REJECTED: 502,
  QUEUE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
  }
}

export function statusForCode(code: ErrorCode): number {
  return HTTP_STATUS[code];
}

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
  };
}
