import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Leave the queue stack as native Node requires instead of bundling it.
   *
   * BullMQ soft-requires alternative Redis backends (`@valkey/valkey-glide`,
   * `redis`, `pg`) that are not installed — we use ioredis. Those are runtime
   * branches BullMQ never takes, but a bundler has to resolve every import it
   * can see, so webpack reported:
   *
   *   Module not found: Can't resolve '@valkey/valkey-glide'
   *
   * Marking the packages external means Node resolves them at runtime, where
   * the untaken branches are simply never required. This is also correct for
   * ioredis independently: it pulls in native bindings that should not be
   * bundled.
   */
  serverExternalPackages: ["bullmq", "ioredis"],

  /**
   * Security headers — Phase 7.
   *
   * Enforced: framing forbidden (clickjacking), MIME sniffing off, referrer
   * trimmed, powerful browser features off, HSTS in production.
   *
   * CSP ships in REPORT-ONLY mode. Next.js hydration needs inline scripts
   * unless nonces are wired through every render, and an enforced CSP that is
   * wrong breaks the app silently in the browser — which this change could
   * not be verified in. Report-only surfaces violations in the console with
   * zero breakage; switching the header name to `Content-Security-Policy`
   * after a clean browser pass enforces it (docs/security/AUDIT.md, F-06).
   */
  async headers() {
    const production = process.env.NODE_ENV === "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      // Template previews render the customer's own HTML, which may load images.
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    const headers = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Content-Security-Policy-Report-Only", value: csp },
      ...(production
        ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
        : []),
    ];

    return [{ source: "/:path*", headers }];
  },

  // Do not advertise the framework version.
  poweredByHeader: false,
};

export default nextConfig;
