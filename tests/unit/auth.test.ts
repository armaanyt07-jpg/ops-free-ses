/**
 * Password reset and email-link handling: the `/auth/confirm` landing route,
 * the reset actions, and the open-redirect guard on `next`. The Supabase
 * client is mocked — these test what the app does with its answers.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { safeNextPath } from "@/lib/auth/next-path";

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signUp: vi.fn(),
  getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.example.test", "x-forwarded-proto": "https" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PUBLIC_APP_URL;
});

describe("safeNextPath", () => {
  it.each([
    ["/reset-password", "/reset-password"],
    ["/dashboard/domains?x=1", "/dashboard/domains?x=1"],
    [null, "/dashboard"],
    ["", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["dashboard", "/dashboard"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("GET /auth/confirm", () => {
  async function confirm(query: string) {
    const { GET } = await import("@/app/auth/confirm/route");
    const res = await GET(new NextRequest(`https://app.example.test/auth/confirm${query}`));
    return { status: res.status, location: res.headers.get("location") };
  }

  it("exchanges a PKCE code and continues to next", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await confirm("?code=abc&next=/reset-password");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(res.location).toBe("https://app.example.test/reset-password");
  });

  it("verifies a token_hash link", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    const res = await confirm("?token_hash=th&type=signup");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "th" });
    expect(res.location).toBe("https://app.example.test/dashboard");
  });

  it("refuses to redirect off-site", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await confirm("?code=abc&next=//evil.example");
    expect(res.location).toBe("https://app.example.test/dashboard");
  });

  it("sends a failed or expired link to sign-in with an explanation", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      error: { name: "AuthApiError", status: 400, code: "flow_state_not_found" },
    });
    const res = await confirm("?code=stale&next=/reset-password");
    expect(res.location).toBe("https://app.example.test/login?link=failed");
  });

  it("treats a link with no token as failed", async () => {
    const res = await confirm("");
    expect(res.location).toBe("https://app.example.test/login?link=failed");
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("auth email links point back at this app", () => {
  it("sign-up confirmation goes through /auth/confirm on PUBLIC_APP_URL", async () => {
    process.env.PUBLIC_APP_URL = "https://ops.example.test/";
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const { signUp } = await import("@/app/login/actions");
    const out = await signUp({}, form({ email: "a@b.test", password: "long-enough" }));
    expect(out.notice).toMatch(/confirm/);
    expect(auth.signUp.mock.calls[0]![0].options.emailRedirectTo).toBe(
      "https://ops.example.test/auth/confirm?next=%2Fdashboard",
    );
  });

  it("falls back to the request host without PUBLIC_APP_URL", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    const { requestPasswordReset } = await import("@/app/login/actions");
    await requestPasswordReset({}, form({ email: "a@b.test" }));
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@b.test", {
      redirectTo: "https://app.example.test/auth/confirm?next=%2Freset-password",
    });
  });
});

describe("requestPasswordReset", () => {
  it("answers the same whether or not the account exists", async () => {
    const { requestPasswordReset } = await import("@/app/login/actions");
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    const known = await requestPasswordReset({}, form({ email: "known@b.test" }));
    auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: { name: "AuthApiError", status: 400, code: "user_not_found" },
    });
    const unknown = await requestPasswordReset({}, form({ email: "nobody@b.test" }));
    expect(unknown).toEqual(known);
    expect(known.notice).toMatch(/reset link/);
  });

  it("says so when rate limited, since the link will not arrive", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { name: "AuthApiError", status: 429, code: "over_email_send_rate_limit" },
    });
    const { requestPasswordReset } = await import("@/app/login/actions");
    const out = await requestPasswordReset({}, form({ email: "a@b.test" }));
    expect(out.error).toMatch(/Too many/);
  });

  it("rejects an invalid address without calling Supabase", async () => {
    const { requestPasswordReset } = await import("@/app/login/actions");
    const out = await requestPasswordReset({}, form({ email: "not-an-email" }));
    expect(out.error).toBeDefined();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("updatePassword", () => {
  it("sets the password and goes to the dashboard", async () => {
    auth.updateUser.mockResolvedValue({ error: null });
    const { updatePassword } = await import("@/app/login/actions");
    await expect(
      updatePassword({}, form({ password: "new-password-1", confirm: "new-password-1" })),
    ).rejects.toThrow("REDIRECT:/dashboard");
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-password-1" });
  });

  it("rejects mismatched or short passwords before calling Supabase", async () => {
    const { updatePassword } = await import("@/app/login/actions");
    expect((await updatePassword({}, form({ password: "new-password-1", confirm: "other-pass-1" }))).error).toMatch(/match/);
    expect((await updatePassword({}, form({ password: "short", confirm: "short" }))).error).toMatch(/8 characters/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("explains a reused password", async () => {
    auth.updateUser.mockResolvedValue({
      error: { name: "AuthApiError", status: 422, code: "same_password" },
    });
    const { updatePassword } = await import("@/app/login/actions");
    const out = await updatePassword({}, form({ password: "old-password-1", confirm: "old-password-1" }));
    expect(out.error).toMatch(/different/);
  });

  it("asks for a new link when there is no recovery session", async () => {
    auth.updateUser.mockResolvedValue({
      error: { name: "AuthSessionMissingError", status: 400 },
    });
    const { updatePassword } = await import("@/app/login/actions");
    const out = await updatePassword({}, form({ password: "new-password-1", confirm: "new-password-1" }));
    expect(out.error).toMatch(/new reset link/);
  });
});
