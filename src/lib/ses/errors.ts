import { ERROR_CODES, type ErrorCode } from "@/lib/api/errors";

/**
 * Classification of AWS SES failures.
 *
 * SRS §8 requires retryable failures to be distinguished from permanent ones:
 * throttling and transient 5xx/network faults back off and retry, permanent
 * rejections terminate. Phase 1 has no queue, so `retryable` is recorded on the
 * log rather than acted on; the Phase 2 worker consumes the same classifier so
 * the policy is defined in exactly one place.
 *
 * AWS credential failures (expired, revoked or mistyped IAM keys) have no
 * dedicated code in the SRS §14 table. They are mapped to SES_REJECTED because
 * they are permanent from the request's point of view — a retry with the same
 * stored credential cannot succeed — and the message names the real cause.
 */
export interface ClassifiedSesError {
  code: ErrorCode;
  /** Provider-side error name, stored in `email_logs.error_code`. */
  providerCode: string;
  message: string;
  retryable: boolean;
  requestId: string | null;
}

const THROTTLE_NAMES = new Set([
  "TooManyRequestsException",
  "ThrottlingException",
  "Throttling",
  "RequestThrottled",
  "RequestThrottledException",
  "LimitExceededException",
  "SlowDown",
]);

const NOT_VERIFIED_NAMES = new Set([
  "MailFromDomainNotVerifiedException",
  "MessageRejected",
  "NotFoundException",
]);

const CREDENTIAL_NAMES = new Set([
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "SignatureDoesNotMatch",
  "AuthFailure",
  "ExpiredToken",
  "ExpiredTokenException",
  "AccessDenied",
  "AccessDeniedException",
  "InvalidAccessKeyId",
]);

const PERMANENT_NAMES = new Set([
  "AccountSuspendedException",
  "SendingPausedException",
  "BadRequestException",
  "InvalidParameterValue",
  "ValidationException",
]);

/**
 * Every AWS error name this classifier knows. Exported so the dashboard's
 * error explanations can be tested against it: a name added here without an
 * explanation fails that test.
 */
export const KNOWN_SES_ERROR_NAMES: readonly string[] = [
  ...THROTTLE_NAMES,
  ...NOT_VERIFIED_NAMES,
  ...CREDENTIAL_NAMES,
  ...PERMANENT_NAMES,
];

interface AwsErrorish {
  name?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: number; requestId?: string };
  $retryable?: { throttling?: boolean };
}

function readAwsError(error: unknown): AwsErrorish {
  return typeof error === "object" && error !== null
    ? (error as AwsErrorish)
    : {};
}

export function classifySesError(error: unknown): ClassifiedSesError {
  const aws = readAwsError(error);
  const name = typeof aws.name === "string" ? aws.name : "UnknownError";
  const message =
    typeof aws.message === "string" && aws.message.length > 0
      ? aws.message
      : "SES call failed without a provider message";
  const status = aws.$metadata?.httpStatusCode;
  const requestId = aws.$metadata?.requestId ?? null;

  const base = { providerCode: name, requestId };

  if (THROTTLE_NAMES.has(name) || aws.$retryable?.throttling === true) {
    return {
      ...base,
      code: ERROR_CODES.SES_THROTTLED,
      message: "SES rejected the send because the sending rate was exceeded",
      retryable: true,
    };
  }

  if (CREDENTIAL_NAMES.has(name)) {
    return {
      ...base,
      code: ERROR_CODES.SES_REJECTED,
      message:
        "AWS rejected the stored credential for this environment. Re-validate or rotate the access key.",
      retryable: false,
    };
  }

  // MessageRejected is SES's catch-all for an unverified or disallowed sender
  // identity, which is the dominant cause in practice and the one the SRS
  // gives a dedicated code to.
  if (NOT_VERIFIED_NAMES.has(name)) {
    return {
      ...base,
      code: ERROR_CODES.DOMAIN_NOT_VERIFIED,
      message,
      retryable: false,
    };
  }

  if (PERMANENT_NAMES.has(name)) {
    return {
      ...base,
      code: ERROR_CODES.SES_REJECTED,
      message,
      retryable: false,
    };
  }

  // Transport faults surface with no HTTP status at all.
  if (status === undefined) {
    return {
      ...base,
      code: ERROR_CODES.SES_REJECTED,
      message: "Could not reach SES",
      retryable: true,
    };
  }

  if (status === 429) {
    return {
      ...base,
      code: ERROR_CODES.SES_THROTTLED,
      message,
      retryable: true,
    };
  }

  if (status >= 500) {
    return {
      ...base,
      code: ERROR_CODES.SES_REJECTED,
      message,
      retryable: true,
    };
  }

  return {
    ...base,
    code: ERROR_CODES.SES_REJECTED,
    message,
    retryable: false,
  };
}
