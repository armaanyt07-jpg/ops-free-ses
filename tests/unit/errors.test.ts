import { describe, expect, it } from "vitest";

import {
  ApiError,
  ERROR_CODES,
  errorEnvelope,
  statusForCode,
} from "@/lib/api/errors";

describe("error model", () => {
  // SRS §7 pins these status codes into the public contract.
  it.each([
    ["INVALID_REQUEST", 400],
    ["UNAUTHORIZED", 401],
    ["DOMAIN_NOT_VERIFIED", 403],
    ["RECIPIENT_SUPPRESSED", 403],
    ["SES_THROTTLED", 429],
    ["QUEUE_UNAVAILABLE", 503],
    ["INTERNAL_ERROR", 500],
  ] as const)("maps %s to HTTP %i", (code, status) => {
    expect(statusForCode(ERROR_CODES[code])).toBe(status);
  });

  it("builds the SRS §7 error envelope", () => {
    const envelope = errorEnvelope(
      ERROR_CODES.DOMAIN_NOT_VERIFIED,
      "The sender domain is not verified for this environment.",
      "req_01",
    );

    expect(envelope).toEqual({
      error: {
        code: "DOMAIN_NOT_VERIFIED",
        message: "The sender domain is not verified for this environment.",
        requestId: "req_01",
      },
    });
  });

  it("omits details when none are supplied", () => {
    const envelope = errorEnvelope(ERROR_CODES.INTERNAL_ERROR, "x", "req_02");
    expect("details" in envelope.error).toBe(false);
  });

  it("carries the right status on ApiError", () => {
    expect(new ApiError(ERROR_CODES.SES_THROTTLED, "slow down").status).toBe(
      429,
    );
  });
});
