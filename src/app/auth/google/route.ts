import { NextResponse, type NextRequest } from "next/server";

import { log } from "@/lib/api/logger";
import { googleRedirectTo, googleSignInEnabled } from "@/lib/auth/google";
import { createClient } from "@/lib/supabase/server";

/**
 * Starts "Continue with Google". Supabase builds the Google URL and stores the
 * PKCE verifier in a cookie on this response; Google then returns the visitor
 * to Supabase, which redirects to /auth/confirm to exchange the code.
 *
 * A plain link (GET), not a form post, so the CSP's `form-action 'self'` has
 * nothing to block on the cross-site redirect. Nothing here is sensitive: it
 * creates no session and takes no credentials.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const login = (search: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = search;
    return NextResponse.redirect(url);
  };

  if (!googleSignInEnabled()) return login("");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: googleRedirectTo(request.nextUrl.origin, request.nextUrl.searchParams.get("next")),
    },
  });

  if (error || !data.url) {
    log.warn({ event: "auth.google_start_failed", requestId: "auth", errorCode: error?.code ?? error?.name });
    return login("?link=oauth");
  }
  return NextResponse.redirect(data.url);
}
