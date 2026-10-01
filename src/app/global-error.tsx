"use client";

import { useEffect } from "react";

import "./globals.css";

/**
 * Last-resort boundary for errors thrown while rendering. It replaces the root
 * layout, so it renders its own <html>. Server-side errors are already
 * reported by src/instrumentation.ts; this reports the browser side.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Lazy, like src/instrumentation-client.ts, to keep the SDK off every page load.
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-md text-sm">
            The error has been reported. Try again, and if it keeps happening, contact support
            {error.digest ? ` and quote reference ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={reset}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
