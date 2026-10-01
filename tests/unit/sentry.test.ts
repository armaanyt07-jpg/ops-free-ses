import type { ErrorEvent } from "@sentry/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/core", () => ({
  captureException: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
}));

const { captureException, flush } = await import("@sentry/core");
const { fingerprint, reportError } = await import("@/lib/observability/errors");
const { scrubBreadcrumb, scrubEvent, sentryOptions } = await import("@/lib/observability/sentry");

/**
 * Sentry forwarding. Everything that leaves for Sentry passes the scrubbers:
 * the send API carries customers' email content, the credential form their
 * AWS secret key, and /auth/confirm a one-time token in its query string.
 */
describe("scrubEvent", () => {
  it("redacts addresses and key-shaped strings in messages and exceptions", () => {
    const event = scrubEvent({
      type: undefined,
      message: "failed for jane@example.com",
      exception: { values: [{ type: "Error", value: "Bearer abc.def rejected for AKIAABCDEFGHIJKLMNOP" }] },
    } as ErrorEvent);
    expect(event.message).toBe("failed for [email]");
    expect(event.exception?.values?.[0]?.value).toBe("[secret] rejected for [secret]");
  });

  it("drops the bound values from database query errors", () => {
    const event = scrubEvent({
      type: undefined,
      exception: {
        values: [{ type: "Error", value: 'Failed query: select "id" from "email_templates" where "html" = $1\nparams: <p>Hi jane</p>,7' }],
      },
    } as ErrorEvent);
    expect(event.exception?.values?.[0]?.value).toBe(
      'Failed query: select "id" from "email_templates" where "html" = $1\nparams: [redacted]',
    );
  });

  it("keeps only the method, the path and the user agent of a request", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        method: "POST",
        url: "https://www.opsfree.in/auth/confirm?token_hash=secret-token&type=recovery#frag",
        data: { html: "<p>customer email</p>", secretAccessKey: "wJalr..." },
        cookies: { "sb-access-token": "jwt" },
        query_string: "token_hash=secret-token",
        headers: { "User-Agent": "Mozilla/5.0", Authorization: "Bearer sk_live_abcdefgh", Cookie: "sb=1" },
      },
    } as ErrorEvent);
    expect(event.request).toEqual({
      method: "POST",
      url: "https://www.opsfree.in/auth/confirm",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
  });

  it("drops the user and scrubs attached breadcrumbs", () => {
    const event = scrubEvent({
      type: undefined,
      user: { id: "u1", email: "jane@example.com", ip_address: "1.2.3.4" },
      breadcrumbs: [{ category: "navigation", data: { from: "/login", to: "/auth/confirm?code=abc" } }],
    } as ErrorEvent);
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs?.[0]?.data).toEqual({ from: "/login", to: "/auth/confirm" });
  });
});

describe("scrubBreadcrumb", () => {
  it("strips query strings from URLs and drops raw console arguments", () => {
    expect(
      scrubBreadcrumb({
        category: "console",
        message: "send failed for jane@example.com",
        data: { arguments: ["jane@example.com", { secret: "x" }], url: "https://api.example.com/v1?key=sk_live_abcdefgh" },
      }),
    ).toEqual({
      category: "console",
      message: "send failed for [email]",
      data: { url: "https://api.example.com/v1" },
    });
  });
});

describe("sentryOptions", () => {
  it("never sends default PII and always installs the scrubbers", () => {
    const options = sentryOptions("https://key@o1.ingest.sentry.io/2", "production", "");
    expect(options).toMatchObject({ sendDefaultPii: false, environment: "production", release: undefined });
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });
});

describe("reportError forwarding", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
  afterEach(() => vi.clearAllMocks());

  it("forwards to Sentry, grouped by the same fingerprint as the log line", () => {
    const error = new Error("boom");
    const fp = reportError(error, { source: "route", route: "/api/v1/send", requestId: "req_1" });

    expect(fp).toBe(fingerprint(error));
    expect(captureException).toHaveBeenCalledWith(error, {
      fingerprint: [fp],
      tags: { source: "route", route: "/api/v1/send" },
      extra: { requestId: "req_1", jobId: undefined },
    });
    expect(flush).toHaveBeenCalled();
  });

  it("hands the flush to Vercel's waitUntil when a request context exists", () => {
    const waitUntil = vi.fn();
    const key = Symbol.for("@vercel/request-context");
    (globalThis as Record<symbol, unknown>)[key] = { get: () => ({ waitUntil }) };
    try {
      reportError(new Error("boom"), { source: "action" });
      expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    } finally {
      delete (globalThis as Record<symbol, unknown>)[key];
    }
  });
});
