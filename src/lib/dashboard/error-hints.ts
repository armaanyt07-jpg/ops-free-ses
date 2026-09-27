/**
 * What an error code means and what to do about it — Phase 4 error tracking.
 *
 * `email_logs.error_code` holds either one of this platform's own codes or the
 * AWS error name the worker received (see `classifySesError`). A developer
 * troubleshooting a failure needs the fix, not just the code, so each code maps
 * to an explanation and, where one exists, the dashboard page that fixes it.
 *
 * Covers every code the platform can currently record; anything else falls
 * back to a generic hint rather than pretending to know.
 */
export interface ErrorHint {
  title: string;
  explanation: string;
  action?: { label: string; href: string } | undefined;
}

const CREDENTIAL: ErrorHint = {
  title: "AWS rejected the stored credential",
  explanation:
    "The access key was deleted, deactivated, mistyped, or lacks the IAM permission for this call. Nothing will send until it is replaced.",
  action: { label: "Update AWS credential", href: "/dashboard/aws" },
};

const THROTTLED: ErrorHint = {
  title: "SES throttled the send",
  explanation:
    "The account's sending rate or daily quota was exceeded. These are retried with backoff; if they end up failed, retries were exhausted. Sandbox accounts are limited to 1 email/second and 200/day.",
  action: { label: "Check quota", href: "/dashboard/aws" },
};

const HINTS: Record<string, ErrorHint> = {
  NO_ACTIVE_CREDENTIAL: {
    title: "No AWS credential for this environment",
    explanation:
      "The message was accepted, but the worker had no active AWS credential to send it with.",
    action: { label: "Add AWS credential", href: "/dashboard/aws" },
  },
  CREDENTIAL_DECRYPTION_FAILED: {
    title: "Stored credential could not be decrypted",
    explanation:
      "The server's ENCRYPTION_KEY changed since the credential was saved. Re-enter the credential for this environment.",
    action: { label: "Re-enter credential", href: "/dashboard/aws" },
  },
  RECIPIENT_SUPPRESSED: {
    title: "Recipient is suppressed",
    explanation:
      "A recipient hard-bounced or complained while the message was waiting in the queue, so it was not sent. This protects sender reputation and is not a fault.",
    action: { label: "View suppressions", href: "/dashboard/suppressions" },
  },
  QUEUE_UNAVAILABLE: {
    title: "Queue unavailable",
    explanation:
      "Redis did not accept the job, so the caller received 503 and the message was never queued. Check the queue backend.",
    action: { label: "System health", href: "/dashboard/health" },
  },
  MessageRejected: {
    title: "SES rejected the message",
    explanation:
      "Usually the sender address or domain is not verified in this SES region — or, in the sandbox, the recipient is not verified either.",
    action: { label: "Verify a domain", href: "/dashboard/domains" },
  },
  MailFromDomainNotVerifiedException: {
    title: "MAIL FROM domain not verified",
    explanation:
      "A custom MAIL FROM domain is configured on the identity but its MX/SPF records are not in place.",
    action: { label: "Domains", href: "/dashboard/domains" },
  },
  NotFoundException: {
    title: "SES resource not found",
    explanation:
      "The sending identity or configuration set does not exist in this region. Check the credential's region matches where the identity lives.",
    action: { label: "Domains", href: "/dashboard/domains" },
  },
  AccountSuspendedException: {
    title: "SES account suspended",
    explanation:
      "AWS has suspended sending for this account, typically over bounce or complaint rates. Resolve it in the AWS console.",
  },
  SendingPausedException: {
    title: "Sending paused",
    explanation:
      "Sending is paused for the account or configuration set. Resume it in the SES console.",
  },
  BadRequestException: {
    title: "SES rejected the request as invalid",
    explanation: "A parameter SES considers malformed — the provider message has the specifics.",
  },
  InvalidParameterValue: {
    title: "Invalid parameter",
    explanation: "SES rejected a value in the message — the provider message has the specifics.",
  },
  ValidationException: {
    title: "SES validation failed",
    explanation: "SES rejected the request's shape — the provider message has the specifics.",
  },
};

for (const name of [
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "SignatureDoesNotMatch",
  "AuthFailure",
  "ExpiredToken",
  "ExpiredTokenException",
  "AccessDenied",
  "AccessDeniedException",
  "InvalidAccessKeyId",
]) {
  HINTS[name] = CREDENTIAL;
}

for (const name of [
  "TooManyRequestsException",
  "ThrottlingException",
  "Throttling",
  "RequestThrottled",
  "RequestThrottledException",
  "LimitExceededException",
  "SlowDown",
]) {
  HINTS[name] = THROTTLED;
}

const FALLBACK: ErrorHint = {
  title: "Delivery failed",
  explanation:
    "Transport errors and SES 5xx responses are retried automatically; this one ended in failure. Open a message for its full error and attempt history.",
  action: { label: "System health", href: "/dashboard/health" },
};

export function hintFor(errorCode: string | null | undefined): ErrorHint {
  return (errorCode && HINTS[errorCode]) || FALLBACK;
}

export function hasSpecificHint(errorCode: string): boolean {
  return errorCode in HINTS;
}
