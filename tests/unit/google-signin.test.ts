/**
 * "Continue with Google": the button, the start route and the failure paths.
 * The route is tested with a stand-in Supabase client: what matters here is
 * what we ask Supabase for, and where we send the visitor back to.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { googleRedirectTo, googleSignInEnabled, googleStartPath } from "@/lib/auth/google";

const signInWithOAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signInWithOAuth } }) }));

const { NextRequest } = await import("next/server");
const { GET } = await import("@/app/auth/google/route");

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const get = (path = "/auth/google") => GET(new NextRequest(`https://www.opsfree.in${path}`));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_SIGNIN", "true");
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({
    data: { url: "https://proj.supabase.co/auth/v1/authorize?provider=google" },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("switch", () => {
  it("is off unless explicitly set to true", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_SIGNIN", "");
    expect(googleSignInEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_SIGNIN", "1");
    expect(googleSignInEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_SIGNIN", "true");
    expect(googleSignInEnabled()).toBe(true);
  });
});

describe("paths", () => {
  it("only carries a same-site next", () => {
    expect(googleStartPath()).toBe("/auth/google");
    expect(googleStartPath("/dashboard/aws")).toBe("/auth/google?next=%2Fdashboard%2Faws");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", ""]) {
      expect(googleStartPath(bad)).toBe("/auth/google");
    }
  });

  it("returns through /auth/confirm, never to an outside address", () => {
    expect(googleRedirectTo("https://www.opsfree.in", "/dashboard/aws")).toBe(
      "https://www.opsfree.in/auth/confirm?next=%2Fdashboard%2Faws",
    );
    expect(googleRedirectTo("https://www.opsfree.in", "//evil.example")).toBe(
      "https://www.opsfree.in/auth/confirm?next=%2Fdashboard",
    );
  });
});

describe("GET /auth/google", () => {
  it("asks Supabase for Google and sends the visitor on to it", async () => {
    const res = await get();
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://www.opsfree.in/auth/confirm?next=%2Fdashboard" },
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://proj.supabase.co/auth/v1/authorize?provider=google");
  });

  it("keeps a safe next and drops an unsafe one", async () => {
    await get("/auth/google?next=%2Fdashboard%2Faws");
    expect(signInWithOAuth.mock.calls[0]![0].options.redirectTo).toContain("next=%2Fdashboard%2Faws");
    await get("/auth/google?next=https%3A%2F%2Fevil.example");
    expect(signInWithOAuth.mock.calls[1]![0].options.redirectTo).toBe(
      "https://www.opsfree.in/auth/confirm?next=%2Fdashboard",
    );
  });

  it("does nothing, and says nothing, while the switch is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_SIGNIN", "");
    const res = await get();
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("explains a Supabase failure on the login page instead of showing an error page", async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { name: "AuthApiError", code: "validation_failed" } });
    const res = await get();
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.search).toBe("?link=oauth");
  });
});

describe("wiring that must not drift", () => {
  it("both auth pages offer the button", () => {
    for (const page of ["src/app/login/page.tsx", "src/app/signup/page.tsx"]) {
      expect(read(page)).toContain("<GoogleSignIn");
    }
  });

  it("the button is a plain link, because the CSP only allows form posts to this site", () => {
    const button = read("src/components/auth/google-button.tsx");
    expect(button).toContain("googleStartPath(");
    expect(button).not.toMatch(/<form|action=/);
    expect(read("next.config.ts")).toContain("form-action 'self'");
  });

  it("the callback tells a cancelled Google sign-in apart from an expired link", () => {
    expect(read("src/app/auth/confirm/route.ts")).toContain('searchParams.get("error")');
    expect(read("src/app/login/page.tsx")).toContain('link === "oauth"');
  });

  it("/auth/* stays public so the route works signed out", () => {
    expect(read("src/lib/supabase/middleware.ts")).toMatch(/PUBLIC_PATHS = \[[^\]]*"\/auth"/);
  });
});
