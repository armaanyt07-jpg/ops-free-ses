import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "@/lib/api/errors";
import { classifySesError } from "@/lib/ses/errors";

function awsError(
  name: string,
  httpStatusCode?: number,
  message = "provider message",
) {
  return {
    name,
    message,
    $metadata: { httpStatusCode, requestId: "aws-req-1" },
  };
}

describe("classifySesError", () => {
  it("treats throttling as retryable", () => {
    const result = classifySesError(awsError("TooManyRequestsException", 429));
    expect(result.code).toBe(ERROR_CODES.SES_THROTTLED);
    expect(result.retryable).toBe(true);
  });

  it("honours the SDK's own throttling flag", () => {
    const result = classifySesError({
      name: "SomeFutureThrottle",
      message: "slow down",
      $retryable: { throttling: true },
      $metadata: { httpStatusCode: 400 },
    });
    expect(result.code).toBe(ERROR_CODES.SES_THROTTLED);
    expect(result.retryable).toBe(true);
  });

  it("maps an unverified identity to DOMAIN_NOT_VERIFIED", () => {
    const result = classifySesError(
      awsError("MailFromDomainNotVerifiedException", 400),
    );
    expect(result.code).toBe(ERROR_CODES.DOMAIN_NOT_VERIFIED);
    expect(result.retryable).toBe(false);
  });

  it("maps MessageRejected to DOMAIN_NOT_VERIFIED, its dominant cause", () => {
    expect(classifySesError(awsError("MessageRejected", 400)).code).toBe(
      ERROR_CODES.DOMAIN_NOT_VERIFIED,
    );
  });

  // Credential failures are permanent for the request: the same stored key
  // cannot succeed on retry.
  it.each([
    "InvalidClientTokenId",
    "UnrecognizedClientException",
    "SignatureDoesNotMatch",
    "ExpiredToken",
    "AccessDeniedException",
  ])("treats %s as a permanent credential failure", (name) => {
    const result = classifySesError(awsError(name, 403));
    expect(result.code).toBe(ERROR_CODES.SES_REJECTED);
    expect(result.retryable).toBe(false);
    expect(result.message).toMatch(/credential/i);
  });

  it("treats a suspended account as permanent", () => {
    const result = classifySesError(awsError("AccountSuspendedException", 400));
    expect(result.code).toBe(ERROR_CODES.SES_REJECTED);
    expect(result.retryable).toBe(false);
  });

  it("treats a 5xx as retryable", () => {
    const result = classifySesError(awsError("InternalFailure", 500));
    expect(result.retryable).toBe(true);
  });

  it("treats an unknown 4xx as permanent", () => {
    const result = classifySesError(awsError("WeirdError", 400));
    expect(result.retryable).toBe(false);
  });

  // A socket error carries no HTTP status at all.
  it("treats a transport failure as retryable", () => {
    const result = classifySesError(
      Object.assign(new Error("connect ETIMEDOUT"), { name: "TimeoutError" }),
    );
    expect(result.retryable).toBe(true);
    expect(result.message).toMatch(/Could not reach SES/);
  });

  it("survives a non-object thrown value", () => {
    const result = classifySesError("something went wrong");
    expect(result.providerCode).toBe("UnknownError");
    expect(result.code).toBe(ERROR_CODES.SES_REJECTED);
  });

  it("preserves the provider request id for support escalation", () => {
    expect(classifySesError(awsError("MessageRejected", 400)).requestId).toBe(
      "aws-req-1",
    );
  });
});
