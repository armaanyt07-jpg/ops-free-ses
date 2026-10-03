import { describe, expect, it, vi } from "vitest";

import { hasSpecificHint, hintFor } from "@/lib/dashboard/error-hints";
import {
  formatCount,
  formatDateTime,
  formatDuration,
  formatRate,
  formatRelative,
} from "@/lib/dashboard/format";
import {
  dayValue,
  hrefWith,
  likePattern,
  parseActivityFilters,
  parsePage,
  parseWindow,
} from "@/lib/dashboard/params";
import { reputationLevel } from "@/lib/dashboard/reputation";
import { KNOWN_SES_ERROR_NAMES } from "@/lib/ses/errors";

vi.mock("server-only", () => ({}));
const { summarise } = await import("@/server/activity");

/**
 * Phase 4's pure pieces: URL state, formatting, error explanations, the SES
 * reputation thresholds and the statistics arithmetic.
 */
describe("URL state", () => {
  it("parses page defensively", () => {
    expect(parsePage({})).toBe(1);
    expect(parsePage({ page: "3" })).toBe(3);
    for (const bad of ["0", "-2", "abc", "99999999"]) expect(parsePage({ page: bad })).toBe(1);
    expect(parsePage({ page: ["4", "9"] })).toBe(4);
  });

  it("only accepts the 1/7/30-day windows, defaulting to 7", () => {
    expect(parseWindow({})).toBe(7);
    expect(parseWindow({ window: "1" })).toBe(1);
    expect(parseWindow({ window: "30" })).toBe(30);
    expect(parseWindow({ window: "90" })).toBe(7);
  });

  it("parses activity filters and drops anything invalid", () => {
    expect(
      parseActivityFilters({
        q: "  bob@x.com ",
        status: "bounced",
        error: "MessageRejected",
        from: "2026-09-01",
        to: "2026-09-02",
      }),
    ).toEqual({
      q: "bob@x.com",
      status: "bounced",
      errorCode: "MessageRejected",
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-02T23:59:59.999Z"),
    });

    expect(parseActivityFilters({ status: "exploded", from: "yesterday", to: "2026-13-45" })).toEqual({
      q: undefined,
      status: undefined,
      errorCode: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it("round-trips a date through the date input value", () => {
    const { from } = parseActivityFilters({ from: "2026-09-27" });
    expect(dayValue(from)).toBe("2026-09-27");
    expect(dayValue(undefined)).toBe("");
  });

  it("builds links that keep filters and reset the page when a filter changes", () => {
    const params = { q: "bob", status: "failed", page: "4" };
    expect(hrefWith("/a", params, { page: 5 })).toBe("/a?q=bob&status=failed&page=5");
    expect(hrefWith("/a", params, { status: "sent" })).toBe("/a?q=bob&status=sent");
    expect(hrefWith("/a", params, { status: undefined })).toBe("/a?q=bob");
    expect(hrefWith("/a", { page: "2" }, { page: 1 })).toBe("/a");
  });

  it("escapes LIKE metacharacters", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
    expect(likePattern("Bob")).toBe("%bob%");
  });
});

describe("formatting", () => {
  it("counts", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(9_999)).toBe("9,999");
    expect(formatCount(12_900)).toBe("12.9K");
    expect(formatCount(4_200_000)).toBe("4.2M");
  });

  it("rates keep precision where SES thresholds live", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(0.001)).toBe("0.10%");
    expect(formatRate(0.0493)).toBe("4.9%");
    expect(formatRate(0.5)).toBe("50%");
  });

  it("times", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    expect(formatDateTime(now)).toBe("2026-09-27 12:00:00 UTC");
    expect(formatRelative(new Date("2026-09-27T11:59:30Z"), now)).toBe("just now");
    expect(formatRelative(new Date("2026-09-27T11:55:00Z"), now)).toBe("5m ago");
    expect(formatRelative(new Date("2026-09-27T09:00:00Z"), now)).toBe("3h ago");
    expect(formatRelative(new Date("2026-09-28T11:00:00Z"), now)).toBe("in 23h");
    expect(formatRelative(new Date("2026-07-01T00:00:00Z"), now)).toBe("2026-07-01");
    expect(formatDuration(320)).toBe("320 ms");
    expect(formatDuration(4_200)).toBe("4.2 s");
  });
});

describe("error hints", () => {
  // Every code the platform can write into email_logs.error_code today: its
  // own codes, plus every AWS error name the classifier recognises.
  const platformCodes = [
    "NO_ACTIVE_CREDENTIAL",
    "CREDENTIAL_DECRYPTION_FAILED",
    "RECIPIENT_SUPPRESSED",
    "QUEUE_UNAVAILABLE",
  ];
  const awsNames = [
    "TooManyRequestsException",
    "ThrottlingException",
    "Throttling",
    "RequestThrottled",
    "RequestThrottledException",
    "LimitExceededException",
    "SlowDown",
    "MailFromDomainNotVerifiedException",
    "MessageRejected",
    "NotFoundException",
    "InvalidClientTokenId",
    "UnrecognizedClientException",
    "SignatureDoesNotMatch",
    "AuthFailure",
    "ExpiredToken",
    "ExpiredTokenException",
    "AccessDenied",
    "AccessDeniedException",
    "InvalidAccessKeyId",
    "AccountSuspendedException",
    "SendingPausedException",
    "BadRequestException",
    "InvalidParameterValue",
    "ValidationException",
  ];

  it.each([...platformCodes, ...awsNames])("explains %s specifically", (code) => {
    expect(hasSpecificHint(code)).toBe(true);
    expect(hintFor(code).explanation.length).toBeGreaterThan(20);
  });

  it("covers every AWS error name the classifier knows — derived, not copied", () => {
    const missing = KNOWN_SES_ERROR_NAMES.filter((name) => !hasSpecificHint(name));
    expect(missing).toEqual([]);
    expect(new Set(awsNames)).toEqual(new Set(KNOWN_SES_ERROR_NAMES));
  });

  it("falls back honestly for unknown codes", () => {
    expect(hasSpecificHint("SomethingNew")).toBe(false);
    expect(hintFor("SomethingNew").title).toBe("Delivery failed");
    expect(hintFor(null).title).toBe("Delivery failed");
  });

  it("links credential problems to the AWS page", () => {
    expect(hintFor("AccessDeniedException").action?.href).toBe("/dashboard/aws");
    expect(hintFor("NO_ACTIVE_CREDENTIAL").action?.href).toBe("/dashboard/aws");
  });
});

describe("reputation thresholds (AWS enforcement)", () => {
  it("bounce: warning at 5%, review at 10%", () => {
    expect(reputationLevel("bounce", null)).toBe("none");
    expect(reputationLevel("bounce", 0.049)).toBe("healthy");
    expect(reputationLevel("bounce", 0.05)).toBe("warning");
    expect(reputationLevel("bounce", 0.1)).toBe("review");
  });

  it("complaint: warning at 0.1%, review at 0.5%", () => {
    expect(reputationLevel("complaint", 0.0009)).toBe("healthy");
    expect(reputationLevel("complaint", 0.001)).toBe("warning");
    expect(reputationLevel("complaint", 0.005)).toBe("review");
  });
});

describe("delivery statistics arithmetic", () => {
  it("computes rates over the right denominators", () => {
    const s = summarise(7, {
      total: 100,
      queued: 3,
      sending: 2,
      sent: 10,
      delivered: 70,
      bounced: 5,
      complained: 1,
      failed: 7,
      suppressed: 2,
    });
    expect(s.inFlight).toBe(5);
    expect(s.reachedSes).toBe(86);
    expect(s.withOutcome).toBe(76);
    // A complaint is about a delivered message.
    expect(s.deliveryRate).toBeCloseTo(71 / 76);
    expect(s.bounceRate).toBeCloseTo(5 / 86);
    expect(s.complaintRate).toBeCloseTo(1 / 86);
  });

  it("has no rates rather than 0% when there is nothing to divide by", () => {
    const s = summarise(1, { total: 3, failed: 3 });
    expect(s.deliveryRate).toBeNull();
    expect(s.bounceRate).toBeNull();
  });

  it("parses the string counts postgres returns", () => {
    expect(summarise(30, { total: "4", delivered: "4" }).delivered).toBe(4);
  });
});

describe("reputation on a handful of sends", () => {
  const few = { sample: 13, events: 1 };

  it("calls a rate over the line 'too early' when few sends and few events back it", () => {
    expect(reputationLevel("bounce", 1 / 13, few)).toBe("early");
    expect(reputationLevel("complaint", 1 / 13, few)).toBe("early");
  });

  it("still warns once enough emails have gone out", () => {
    expect(reputationLevel("bounce", 0.06, { sample: 100, events: 6 })).toBe("warning");
    expect(reputationLevel("bounce", 0.12, { sample: 250, events: 30 })).toBe("review");
    expect(reputationLevel("complaint", 0.006, { sample: 1000, events: 6 })).toBe("review");
  });

  it("never hides a real problem at low volume: five bounces or complaints is a signal", () => {
    expect(reputationLevel("bounce", 0.5, { sample: 10, events: 5 })).toBe("review");
    expect(reputationLevel("complaint", 0.5, { sample: 10, events: 5 })).toBe("review");
    expect(reputationLevel("bounce", 0.5, { sample: 10, events: 4 })).toBe("early");
  });

  it("only softens rates that were over the line; healthy and empty are unchanged", () => {
    expect(reputationLevel("bounce", 0.01, few)).toBe("healthy");
    expect(reputationLevel("bounce", null, { sample: 0, events: 0 })).toBe("none");
  });

  it("without evidence it behaves exactly as before", () => {
    expect(reputationLevel("bounce", 0.05)).toBe("warning");
    expect(reputationLevel("complaint", 0.005)).toBe("review");
  });
});
