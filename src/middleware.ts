import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Session refresh applies to the dashboard only.
     *
     * `/api/` is excluded rather than allow-listed inside the middleware: the
     * send endpoint authenticates by API key, so running a Supabase
     * `getUser()` round trip on it would add a network call to the hot path
     * for no benefit, against the SRS §5 sub-100ms ingestion target.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
