import { describe, expect, it } from "vitest";

import { newRequestId, resolveRequestId } from "@/lib/api/request-id";

describe("newRequestId", () => {
  it("is prefixed and unique", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id.startsWith("req_")).toBe(true);
  });
});

describe("resolveRequestId", () => {
  it("honours a well-formed inbound id so callers can correlate traces", () => {
    expect(resolveRequestId("trace-abc.123:xyz")).toBe("trace-abc.123:xyz");
  });

  it("generates one when absent", () => {
    expect(resolveRequestId(null).startsWith("req_")).toBe(true);
  });

  // The id reaches logs and response bodies, so it must not carry control
  // characters or newlines.
  it.each([
    ["a newline", "abc\ndef"],
    ["a carriage return", "abc\r\ndef"],
    ["a space", "abc def"],
    ["a quote", 'abc"def'],
    ["ANSI escapes", "\u001b[31mred"],
    ["a null byte", "abc\u0000def"],
  ])("replaces an id containing %s", (_label, inbound) => {
    expect(resolveRequestId(inbound).startsWith("req_")).toBe(true);
  });

  it("replaces an over-long id", () => {
    expect(resolveRequestId("a".repeat(200)).startsWith("req_")).toBe(true);
  });

  it("replaces a blank id", () => {
    expect(resolveRequestId("   ").startsWith("req_")).toBe(true);
  });
});
