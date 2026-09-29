import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Sign-out. Refuses cross-site POSTs (Phase 7): route handlers do not get the
 * origin check Next.js applies to Server Actions, and without one any site
 * could log a user out with an auto-submitting form.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Cross-site sign-out refused", { status: 403 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
}
