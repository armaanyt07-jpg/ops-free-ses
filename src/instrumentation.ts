/**
 * Next.js instrumentation — Phase 7 error monitoring.
 *
 * `onRequestError` receives every error thrown while rendering a page or
 * running a Server Action or route handler, and reports it through the same
 * structured, fingerprinted channel as the API routes and the worker.
 */
export async function register(): Promise<void> {
  // Reporting is a structured log line (src/lib/observability/errors.ts);
  // Sentry, when configured, receives the same errors through it. Only the
  // Node runtime reports, as in `onRequestError` below.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (dsn) {
      const Sentry = await import("@sentry/nextjs");
      const { sentryOptions } = await import("@/lib/observability/sentry");
      Sentry.init(
        sentryOptions(dsn, process.env.VERCEL_ENV ?? process.env.NODE_ENV, process.env.VERCEL_GIT_COMMIT_SHA),
      );
    }
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  // The bundler strips this branch from the edge build only in this exact form.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportError } = await import("@/lib/observability/errors");
    const requestId = request.headers["x-request-id"];
    reportError(error, {
      source: context.routeType === "action" ? "action" : context.routeType === "route" ? "route" : "page",
      route: context.routePath,
      requestId: typeof requestId === "string" ? requestId : undefined,
    });
  }
}
