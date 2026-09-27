import { describe, expect, it } from "vitest";

import { applyEventToLog } from "@/lib/ses/delivery-state";
import {
  parseSesNotification,
  redactEvent,
  restoreEvent,
  type SesEvent,
} from "@/lib/ses/notification";
import {
  SUPPRESSION_POLICY,
  suppressionsFor,
} from "@/lib/ses/suppression-policy";
import { domainPollDelayMs, DOMAIN_POLL_ATTEMPTS } from "@/lib/queue/domain-queue";

import { sesEvents } from "../support/sns";

/**
 * SES event parsing, log state transitions and suppression policy — the pure
 * core of FR-5. The webhook integration test drives the same code through the
 * route and the database.
 */
const parse = (body: unknown) => parseSesNotification(JSON.stringify(body))!;

describe("parseSesNotification", () => {
  it("parses a permanent bounce, lowercasing addresses", () => {
    const e = parse(sesEvents.bounce("m1", ["Bob@Example.com"]));
    expect(e).toMatchObject({
      kind: "bounce",
      sesMessageId: "m1",
      bounceType: "Permanent",
      recipients: [{ email: "bob@example.com", status: "5.1.1" }],
    });
    expect(e.at).toBeInstanceOf(Date);
  });

  it("parses a complaint and a delivery", () => {
    expect(parse(sesEvents.complaint("m2", ["a@x.com"]))).toMatchObject({
      kind: "complaint",
      recipients: ["a@x.com"],
      feedbackType: "abuse",
    });
    expect(parse(sesEvents.delivery("m3", ["a@x.com"]))).toMatchObject({
      kind: "delivery",
      recipients: ["a@x.com"],
      processingTimeMillis: 812,
    });
  });

  it("accepts configuration-set events (`eventType`) as well", () => {
    const { notificationType: _n, ...rest } = sesEvents.bounce("m4", ["a@x.com"]);
    expect(parse({ ...rest, eventType: "Bounce" }).kind).toBe("bounce");
  });

  it("treats an unknown bounceType as Undetermined", () => {
    const body = sesEvents.bounce("m5", ["a@x.com"]);
    body.bounce.bounceType = "Weird" as never;
    expect(parse(body)).toMatchObject({ bounceType: "Undetermined" });
  });

  it("returns other SES events as `other`, keeping the message id", () => {
    expect(
      parse({ eventType: "Send", mail: { messageId: "m6" } }),
    ).toMatchObject({ kind: "other", type: "Send", sesMessageId: "m6" });
  });

  it("returns null for non-SES and non-JSON messages", () => {
    expect(parseSesNotification("hello")).toBeNull();
    expect(parseSesNotification('{"foo":1}')).toBeNull();
    expect(parseSesNotification("[1,2]")).toBeNull();
  });

  it("bounds the diagnostic code", () => {
    const body = sesEvents.bounce("m7", ["a@x.com"]);
    body.bounce.bouncedRecipients[0]!.diagnosticCode = "x".repeat(10_000);
    const e = parse(body);
    expect(e.kind === "bounce" && e.recipients[0]!.diagnostic!.length).toBe(500);
  });
});

describe("redactEvent / restoreEvent", () => {
  it("persists no headers, subject or sender", () => {
    const e = parse(sesEvents.bounce("m1", ["a@x.com"]));
    const stored = JSON.stringify(redactEvent(e));
    expect(stored).not.toContain("Secret subject line");
    expect(stored).not.toContain("sender@example.com");
    expect(stored).not.toContain("headers");
  });

  it.each([
    ["bounce", sesEvents.bounce("m1", ["a@x.com", "b@x.com"], "Transient")],
    ["complaint", sesEvents.complaint("m2", ["a@x.com"])],
    ["delivery", sesEvents.delivery("m3", ["a@x.com"])],
  ])("round-trips a %s through its stored form", (_kind, body) => {
    const original = parse(body);
    const restored = restoreEvent({
      eventType: { bounce: "Bounce", complaint: "Complaint", delivery: "Delivery" }[
        original.kind as "bounce"
      ],
      sesMessageId: original.sesMessageId,
      eventAt: original.at,
      // Through JSON, as it would be through jsonb.
      payload: JSON.parse(JSON.stringify(redactEvent(original))),
    });
    expect(restored).toEqual(original);
  });
});

describe("applyEventToLog", () => {
  const log = (status = "sent" as const, providerEvent: unknown = null) => ({
    status,
    recipients: ["A@x.com", "b@x.com"],
    providerEvent,
  });

  const delivery = (to: string[]) => parse(sesEvents.delivery("m", to));
  const bounce = (to: string[], type: "Permanent" | "Transient" = "Permanent") =>
    parse(sesEvents.bounce("m", to, type));
  const complaint = (to: string[]) => parse(sesEvents.complaint("m", to));

  it("delivered for one of two recipients: status delivered, not complete", () => {
    const u = applyEventToLog(log(), delivery(["a@x.com"]), "sns-1")!;
    expect(u.status).toBe("delivered");
    expect(u.complete).toBe(false);
    expect(u.providerEvent.recipients).toHaveProperty("a@x.com");
  });

  it("complete once every recipient has an outcome", () => {
    const first = applyEventToLog(log(), delivery(["a@x.com"]), "s1")!;
    const second = applyEventToLog(
      { ...log(), status: first.status, providerEvent: first.providerEvent },
      bounce(["b@x.com"]),
      "s2",
    )!;
    expect(second.status).toBe("bounced");
    expect(second.complete).toBe(true);
  });

  it("the row shows the most severe outcome across recipients", () => {
    const first = applyEventToLog(log(), complaint(["b@x.com"]), "s1")!;
    const second = applyEventToLog(
      { ...log(), status: first.status, providerEvent: first.providerEvent },
      delivery(["a@x.com"]),
      "s2",
    )!;
    expect(second.status).toBe("complained");
  });

  it("an out-of-order delivery never downgrades a complaint", () => {
    const complained = applyEventToLog(log(), complaint(["a@x.com"]), "s1")!;
    const late = applyEventToLog(
      { ...log(), status: complained.status, providerEvent: complained.providerEvent },
      delivery(["a@x.com"]),
      "s2",
    );
    expect(late).toBeNull();
  });

  it("a complaint after delivery upgrades the recipient", () => {
    const delivered = applyEventToLog(log(), delivery(["a@x.com"]), "s1")!;
    const u = applyEventToLog(
      { ...log(), status: delivered.status, providerEvent: delivered.providerEvent },
      complaint(["a@x.com"]),
      "s2",
    )!;
    expect(u.status).toBe("complained");
    expect(
      (u.providerEvent.recipients as Record<string, { status: string }>)["a@x.com"]!.status,
    ).toBe("complained");
  });

  it("ignores addresses that are not on the log", () => {
    expect(applyEventToLog(log(), bounce(["stranger@x.com"]), "s1")).toBeNull();
  });

  it("ignores events that carry no state", () => {
    const other: SesEvent = { kind: "other", type: "Send", sesMessageId: "m", at: null };
    expect(applyEventToLog(log(), other, "s1")).toBeNull();
  });

  it("keeps earlier providerEvent fields (retry history) alongside recipients", () => {
    const u = applyEventToLog(
      log("sent", { attempt: 3, retryable: true }),
      delivery(["a@x.com"]),
      "s1",
    )!;
    expect(u.providerEvent).toMatchObject({ attempt: 3, retryable: true });
  });

  it("supersedes `sending` — an SES event proves SES accepted the message", () => {
    expect(applyEventToLog(log("sending" as never), delivery(["a@x.com"]), "s1")!.status).toBe(
      "delivered",
    );
  });
});

describe("suppression policy", () => {
  it("pins the policy SRS §11 describes", () => {
    expect(SUPPRESSION_POLICY).toEqual({
      permanentBounce: true,
      transientBounce: false,
      undeterminedBounce: false,
      complaint: true,
    });
  });

  it("suppresses every recipient of a hard bounce", () => {
    expect(suppressionsFor(parse(sesEvents.bounce("m", ["a@x.com", "b@x.com"])))).toEqual([
      { email: "a@x.com", reason: "hard_bounce" },
      { email: "b@x.com", reason: "hard_bounce" },
    ]);
  });

  it("suppresses complainers", () => {
    expect(suppressionsFor(parse(sesEvents.complaint("m", ["a@x.com"])))).toEqual([
      { email: "a@x.com", reason: "complaint" },
    ]);
  });

  it("does not suppress transient or undetermined bounces, or deliveries", () => {
    expect(suppressionsFor(parse(sesEvents.bounce("m", ["a@x.com"], "Transient")))).toEqual([]);
    expect(suppressionsFor(parse(sesEvents.bounce("m", ["a@x.com"], "Undetermined")))).toEqual([]);
    expect(suppressionsFor(parse(sesEvents.delivery("m", ["a@x.com"])))).toEqual([]);
  });
});

describe("domain polling schedule", () => {
  it("doubles from one minute to a two-hour ceiling", () => {
    expect([1, 2, 3, 4, 7, 8, 20].map(domainPollDelayMs)).toEqual([
      60_000, 120_000, 240_000, 480_000, 3_840_000, 7_200_000, 7_200_000,
    ]);
  });

  it("is bounded to roughly a day, inside SES's 72-hour window", () => {
    let total = 60_000; // the initial delay
    for (let n = 1; n < DOMAIN_POLL_ATTEMPTS; n++) total += domainPollDelayMs(n);
    const hours = total / 3_600_000;
    expect(hours).toBeGreaterThan(12);
    expect(hours).toBeLessThan(72);
  });
});
