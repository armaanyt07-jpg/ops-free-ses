import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { log } from "@/lib/api/logger";
import { safeNextPath } from "@/lib/auth/next-path";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing route for every auth email: sign-up confirmation and password reset.
 *
 * Supabase's default links verify the token on Supabase, then redirect here
 * with a PKCE `?code=`, which is exchanged for a session. A custom email
 * template can instead link here with `?token_hash=&type=`, verified directly.
 *
 * On failure the email address may still be confirmed (Supabase verifies
 * before redirecting); the code exchange fails if the link was opened in a
 * different browser from the one that signed up. The login page explains
 * both cases rather than guessing which one happened.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  let error: { status?: number | undefined; code?: string | undefined; name: string } | null = null;

  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  } else {
    error = { name: "MissingAuthParams" };
  }

  if (error) {
    log.warn({
      event: "auth.link_failed",
      requestId: "auth",
      status: String(error.status ?? ""),
      errorCode: error.code ?? error.name,
    });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?link=failed";
    return NextResponse.redirect(url);
  }

  const url = request.nextUrl.clone();
  url.pathname = next;
  url.search = "";
  return NextResponse.redirect(url);
}
