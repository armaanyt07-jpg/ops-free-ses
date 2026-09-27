import { describe, expect, it } from "vitest";

import {
  normaliseRecipients,
  sendRequestSchema,
} from "@/lib/api/send-schema";

const valid = {
  from: "noreply@example.com",
  to: ["alice@example.com"],
  subject: "Welcome",
  html: "<h1>Hello</h1>",
};

describe("sendRequestSchema", () => {
  it("accepts a minimal valid request", () => {
    expect(sendRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts text-only content", () => {
    const { html: _html, ...rest } = valid;
    expect(
      sendRequestSchema.safeParse({ ...rest, text: "Hello" }).success,
    ).toBe(true);
  });

  it("requires at least one of html or text", () => {
    const { html: _html, ...rest } = valid;
    const result = sendRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid sender", () => {
    expect(
      sendRequestSchema.safeParse({ ...valid, from: "not-an-email" }).success,
    ).toBe(false);
  });

  it("rejects an empty recipient list", () => {
    expect(sendRequestSchema.safeParse({ ...valid, to: [] }).success).toBe(
      false,
    );
  });

  it("rejects more than 50 recipients (SES destination limit)", () => {
    const to = Array.from({ length: 51 }, (_, i) => `u${i}@example.com`);
    expect(sendRequestSchema.safeParse({ ...valid, to }).success).toBe(false);
  });

  it("accepts exactly 50 recipients", () => {
    const to = Array.from({ length: 50 }, (_, i) => `u${i}@example.com`);
    expect(sendRequestSchema.safeParse({ ...valid, to }).success).toBe(true);
  });

  it("rejects an empty subject", () => {
    expect(
      sendRequestSchema.safeParse({ ...valid, subject: "" }).success,
    ).toBe(false);
  });

  // varchar(998) in email_logs: reject at the edge, not at the insert.
  it("rejects a subject longer than the column", () => {
    expect(
      sendRequestSchema.safeParse({ ...valid, subject: "x".repeat(999) })
        .success,
    ).toBe(false);
  });

  it("rejects unknown fields rather than silently dropping them", () => {
    expect(
      sendRequestSchema.safeParse({ ...valid, replyTo: "a@example.com" })
        .success,
    ).toBe(false);
  });

  it("rejects non-string tag values", () => {
    expect(
      sendRequestSchema.safeParse({ ...valid, tags: { count: 3 } }).success,
    ).toBe(false);
  });

  it("parses the SRS §7 example body", () => {
    const result = sendRequestSchema.safeParse({
      from: "noreply@example.com",
      to: ["alice@example.com", "bob@example.com"],
      subject: "Welcome {{first_name}}",
      html: "<h1>Hello {{first_name}}</h1>",
      text: "Hello {{first_name}}",
      variables: { first_name: "Alice" },
      tags: { campaign: "onboarding" },
    });
    expect(result.success).toBe(true);
  });
});

describe("normaliseRecipients", () => {
  it("removes case-insensitive duplicates", () => {
    expect(
      normaliseRecipients(["A@example.com", "a@example.com", "b@example.com"]),
    ).toEqual(["A@example.com", "b@example.com"]);
  });

  it("preserves the caller's ordering", () => {
    expect(normaliseRecipients(["c@x.com", "a@x.com"])).toEqual([
      "c@x.com",
      "a@x.com",
    ]);
  });

  it("leaves a list with no duplicates untouched", () => {
    const to = ["a@x.com", "b@x.com"];
    expect(normaliseRecipients(to)).toEqual(to);
  });
});
