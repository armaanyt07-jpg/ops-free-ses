/**
 * "Continue with Google" (Supabase OAuth).
 *
 * Inert until `NEXT_PUBLIC_GOOGLE_SIGNIN=true`, so the button never shows
 * before the provider is configured in Supabase (an unconfigured provider
 * lands the visitor on a raw Supabase error page). Turn it on only after the
 * Google provider and the redirect URL are set up: see
 * docs/operations/DEPLOYMENT.md.
 *
 * Pure and dependency-free so the pages, the route and the tests share it.
 */
import { safeNextPath } from "@/lib/auth/next-path";

export function googleSignInEnabled(): boolean {
  // Direct property access so Next.js can inline it into the client bundle.
  return process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "true";
}

/** The link the button points at. `next` is validated again by the route. */
export function googleStartPath(next?: string | null): string {
  const safe = safeNextPath(next, "");
  return safe ? `/auth/google?next=${encodeURIComponent(safe)}` : "/auth/google";
}

/** Where Supabase sends the visitor back to once Google has answered. */
export function googleRedirectTo(origin: string, next?: string | null): string {
  return `${origin}/auth/confirm?next=${encodeURIComponent(safeNextPath(next))}`;
}
