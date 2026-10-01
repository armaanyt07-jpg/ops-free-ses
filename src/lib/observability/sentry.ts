import type { Breadcrumb, ErrorEvent } from "@sentry/core";

import { redact } from "./errors";

/**
 * Sentry options shared by the browser, the Next.js server and the worker.
 *
 * Sentry is optional: with no DSN nothing is initialised and `reportError`'s
 * forwarding is a no-op. When it is on, everything that leaves the process
 * passes through the scrubbers below first:
 *
 * - messages are redacted with the same rules as the `error.unhandled` log
 *   line (email addresses, key-shaped strings);
 * - request bodies, cookies and headers are dropped — a send request carries
 *   the customer's email content, a credential form their AWS secret key;
 * - query strings are dropped from every URL — `/auth/confirm` carries a
 *   one-time sign-in token there;
 * - no user, IP or local variables (`sendDefaultPii: false`).
 */
export interface SentryBaseOptions {
  dsn: string;
  environment: string;
  release: string | undefined;
  sendDefaultPii: false;
  beforeSend: (event: ErrorEvent) => ErrorEvent;
  beforeBreadcrumb: (breadcrumb: Breadcrumb) => Breadcrumb;
}

export function sentryOptions(dsn: string, environment: string, release?: string): SentryBaseOptions {
  return {
    dsn,
    environment,
    release: release || undefined,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

function stripQuery(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? "";
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = redact(event.message);
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redact(value.value);
  }

  if (event.request) {
    const userAgent = event.request.headers?.["User-Agent"] ?? event.request.headers?.["user-agent"];
    event.request = {
      method: event.request.method,
      url: event.request.url ? stripQuery(event.request.url) : undefined,
      headers: userAgent ? { "User-Agent": userAgent } : undefined,
    };
  }
  delete event.user;

  for (const breadcrumb of event.breadcrumbs ?? []) scrubBreadcrumb(breadcrumb);
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.message) breadcrumb.message = redact(breadcrumb.message);
  const data = breadcrumb.data;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = stripQuery(data[key]);
    }
    // Console breadcrumbs repeat the raw arguments; the redacted message is enough.
    delete data.arguments;
  }
  return breadcrumb;
}
