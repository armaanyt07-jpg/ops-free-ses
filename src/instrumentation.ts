/**
 * Next.js instrumentation — Phase 7 error monitoring.
 *
 * `onRequestError` receives every error thrown while rendering a page or
 * running a Server Action or route handler, and reports it through the same
 * structured, fingerprinted channel as the API routes and the worker.
 */
export async function register(): Promise<void> {
  // Nothing to initialise: reporting is a structured log line (see
  // src/lib/observability/errors.ts and docs/operations/OBSERVABILITY.md).
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
