/**
 * Error monitoring — Phase 7.
 *
 * Every unexpected error, from any route, page, Server Action or the worker,
 * is reported through here as one structured line:
 *
 *   { level: "error", event: "error.unhandled", fingerprint, source, name,
 *     message, frames, requestId, ... }
 *
 * `fingerprint` is a hash of the error's type and top stack frames — the same
 * bug always produces the same fingerprint, so a log tool can group, count
 * and alert on it. When Sentry is configured (src/lib/observability/sentry.ts)
 * the error is also forwarded there, grouped by the same fingerprint; with no
 * DSN that forwarding is a no-op. See docs/operations/OBSERVABILITY.md.
 *
 * Messages are redacted before they are logged: provider errors quote email
 * addresses ("Email address is not verified: …"), and SRS §9 forbids logging
 * unnecessary PII.
 */
import { captureException, flush } from "@sentry/core";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRETISH = /\b(sk_(live|test)_[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|Bearer\s+\S+)/g;

// Drizzle's query errors end with the bound values ("Failed query: …\nparams:
// a,b"), which can be anything a customer stored. The SQL alone identifies
// the failing query.
const QUERY_PARAMS = /\nparams: [\s\S]*$/;

export function redact(text: string): string {
  return text.replace(QUERY_PARAMS, "\nparams: [redacted]").replace(EMAIL, "[email]").replace(SECRETISH, "[secret]");
}

function frames(error: Error): string[] {
  return (error.stack ?? "")
    .split("\n")
    .slice(1)
    .map((l) => l.trim().replace(/^at\s+/, ""))
    .filter((l) => l && !l.includes("node_modules") && !l.startsWith("node:"))
    .map((l) => l.replace(/\(?\/.*\/(src|worker|app)\//, "($1/").replace(/:\d+\)?$/, ")"))
    .slice(0, 5);
}

/**
 * 64-bit FNV-1a over the error's type and top frames. Grouping needs a stable
 * hash, not a cryptographic one — and this runs in every runtime (Node and
 * edge), which `node:crypto` does not.
 */
export function fingerprint(error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const input = `${e.name}|${frames(e).slice(0, 3).join("|")}`;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export interface ErrorContext {
  source: "route" | "page" | "action" | "worker" | "process";
  requestId?: string | undefined;
  route?: string | undefined;
  jobId?: string | undefined;
}

export function reportError(error: unknown, context: ErrorContext): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const fp = fingerprint(e);
  console.error(
    JSON.stringify({
      level: "error",
      ts: new Date().toISOString(),
      event: "error.unhandled",
      fingerprint: fp,
      ...context,
      name: e.name,
      message: redact(e.message).slice(0, 500),
      frames: frames(e),
    }),
  );
  captureException(e, {
    fingerprint: [fp],
    tags: { source: context.source, ...(context.route ? { route: context.route } : {}) },
    extra: { requestId: context.requestId, jobId: context.jobId },
  });
  keepAlive(flush(2_000));
  return fp;
}

/** Waits (bounded) for queued error reports to be delivered — before a process exits. */
export function flushErrors(timeoutMs = 2_000): Promise<boolean> {
  return flush(timeoutMs);
}

type RequestContext = { get?: () => { waitUntil?: (task: Promise<unknown>) => void } | undefined };

/**
 * On Vercel a function can be frozen as soon as its response is sent, which
 * would strand the report in Sentry's queue. The platform's request context
 * offers `waitUntil` to keep it alive until delivery. Elsewhere — the worker,
 * tests — there is no such context and the flush simply runs.
 */
function keepAlive(task: Promise<unknown>): void {
  const context = (globalThis as Record<symbol, RequestContext | undefined>)[Symbol.for("@vercel/request-context")];
  context?.get?.()?.waitUntil?.(task);
}
