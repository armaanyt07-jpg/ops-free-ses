import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SERVICE_PAUSED } from "@/lib/service-status";

/**
 * Refreshes the Supabase session cookie on every matched request and gates the
 * dashboard.
 *
 * The middleware is a convenience redirect, not the security boundary: every
 * server action and route handler independently re-establishes the caller's
 * identity and enforces tenant ownership (SRS §9).
 */
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth", "/guide", "/terms", "/privacy", "/security", "/tools", "/blog", "/aws-connect.yaml", "/sitemap.xml", "/robots.txt"];

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  // Paused: Supabase may be off, so don't call it. Public pages load as usual;
  // everything behind sign-in goes to /login, which explains the pause.
  if (SERVICE_PAUSED) {
    const { pathname } = request.nextUrl;
    if (isPublicPath(pathname)) return NextResponse.next({ request });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be getUser(), not getSession(): only getUser() revalidates the JWT
  // with the auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
