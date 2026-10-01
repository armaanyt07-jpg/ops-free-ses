import { sentryOptions } from "@/lib/observability/sentry";

/**
 * Browser error monitoring: uncaught errors and unhandled rejections in the
 * dashboard reach Sentry; render errors arrive through
 * src/app/global-error.tsx. Off unless NEXT_PUBLIC_SENTRY_DSN is set.
 *
 * The SDK is loaded lazily: imported statically it nearly doubled the
 * JavaScript every page loads (103 kB → 186 kB shared). Fetched in the
 * background instead, it misses only an error thrown in the first moments of
 * a page load, before it arrives.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => Sentry.init(sentryOptions(dsn, process.env.NODE_ENV)));
}
