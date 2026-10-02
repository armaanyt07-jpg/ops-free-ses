/**
 * Bot protection on the auth forms (Cloudflare Turnstile). Inert without a
 * site key; with one, every protected action must carry the token to Supabase,
 * refuse a missing one clearly, and map a rejected one to a friendly message.
 * The static checks at the end are what keep a form from being added or edited
 * without the check, which would lock users out once Supabase enforces it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CAPTCHA_FAILED_MESSAGE,
  TURNSTILE_ORIGIN,
  formNeedsCaptcha,
  isCaptchaError,
  readCaptchaToken,
  turnstileSiteKey,
} from "@/lib/auth/captcha";

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
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

const form = (values: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

const KEY = "SITE_KEY_FOR_TESTS";
const creds = { email: "a@example.com", password: "correct-horse" };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  delete process.env.PUBLIC_APP_URL;
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
});

describe("turnstileSiteKey / readCaptchaToken", () => {
  it("is off without a site key, and forwards nothing even if a token arrives", () => {
    expect(turnstileSiteKey()).toBeUndefined();
    expect(readCaptchaToken(form({ captchaToken: "stray" }))).toEqual({ ok: true, token: undefined });
  });

  it("treats a blank or whitespace site key as off", () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "   ";
    expect(turnstileSiteKey()).toBeUndefined();
  });

  it("with a site key, returns the token", () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = KEY;
    expect(readCaptchaToken(form({ captchaToken: " tok-123 " }))).toEqual({ ok: true, token: "tok-123" });
  });

  it.each([[{}], [{ captchaToken: "" }], [{ captchaToken: "   " }]])("with a site key, refuses a missing token %j", (values) => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = KEY;
    const result = readCaptchaToken(form(values));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/human check/);
  });

  it("recognises Supabase's captcha_failed code and nothing else", () => {
    expect(isCaptchaError({ code: "captcha_failed" })).toBe(true);
    expect(isCaptchaError({ code: "invalid_credentials" })).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
    expect(isCaptchaError(undefined)).toBe(false);
  });

  it("only the new-password form is exempt", () => {
    expect(formNeedsCaptcha("credentials")).toBe(true);
    expect(formNeedsCaptcha("email")).toBe(true);
    expect(formNeedsCaptcha("new-password")).toBe(false);
  });
});

describe("the actions carry the token to Supabase", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = KEY;
  });

  it("signIn passes captchaToken", async () => {
    const { signIn } = await import("@/app/login/actions");
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(signIn({}, form({ ...creds, captchaToken: "tok" }))).rejects.toThrow("REDIRECT:/dashboard");
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ ...creds, options: { captchaToken: "tok" } });
  });

  it("signUp passes captchaToken alongside the redirect", async () => {
    const { signUp } = await import("@/app/login/actions");
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    await signUp({}, form({ ...creds, captchaToken: "tok" }));
    const options = auth.signUp.mock.calls[0]![0].options;
    expect(options.captchaToken).toBe("tok");
    expect(options.emailRedirectTo).toContain("/auth/confirm");
  });

  it("requestPasswordReset passes captchaToken alongside the redirect", async () => {
    const { requestPasswordReset } = await import("@/app/login/actions");
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await requestPasswordReset({}, form({ email: creds.email, captchaToken: "tok" }));
    const options = auth.resetPasswordForEmail.mock.calls[0]![1];
    expect(options.captchaToken).toBe("tok");
    expect(options.redirectTo).toContain("/auth/confirm");
    expect(decodeURIComponent(options.redirectTo)).toContain("next=/reset-password");
  });

  it.each([
    ["signIn", () => import("@/app/login/actions").then((m) => m.signIn), creds, auth.signInWithPassword],
    ["signUp", () => import("@/app/login/actions").then((m) => m.signUp), creds, auth.signUp],
    ["requestPasswordReset", () => import("@/app/login/actions").then((m) => m.requestPasswordReset), { email: creds.email }, auth.resetPasswordForEmail],
  ] as const)("%s refuses a missing token without calling Supabase", async (_name, load, values, supabaseCall) => {
    const action = await load();
    const result = await action({}, form(values));
    expect(result.error).toMatch(/human check/);
    expect(supabaseCall).not.toHaveBeenCalled();
  });

  it.each([
    ["signIn", () => import("@/app/login/actions").then((m) => m.signIn), creds, () => auth.signInWithPassword.mockResolvedValue({ error: { code: "captcha_failed", status: 400 } })],
    ["signUp", () => import("@/app/login/actions").then((m) => m.signUp), creds, () => auth.signUp.mockResolvedValue({ data: { session: null }, error: { code: "captcha_failed", status: 400 } })],
    ["requestPasswordReset", () => import("@/app/login/actions").then((m) => m.requestPasswordReset), { email: creds.email }, () => auth.resetPasswordForEmail.mockResolvedValue({ error: { code: "captcha_failed", status: 400 } })],
  ] as const)("%s shows a friendly message when Supabase rejects the token", async (_name, load, values, arrange) => {
    arrange();
    const action = await load();
    const result = await action({}, form({ ...values, captchaToken: "spent" }));
    expect(result.error).toBe(CAPTCHA_FAILED_MESSAGE);
  });

  it("a rejected token on sign-in does not look like a wrong password", async () => {
    const { signIn } = await import("@/app/login/actions");
    auth.signInWithPassword.mockResolvedValue({ error: { code: "captcha_failed", status: 400 } });
    const result = await signIn({}, form({ ...creds, captchaToken: "x" }));
    expect(result.error).not.toMatch(/credentials/i);
  });
});

describe("without a site key nothing changes", () => {
  it("signIn sends no options at all", async () => {
    const { signIn } = await import("@/app/login/actions");
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(signIn({}, form(creds))).rejects.toThrow("REDIRECT:/dashboard");
    expect(auth.signInWithPassword).toHaveBeenCalledWith(creds);
  });

  it("signUp sends no captchaToken", async () => {
    const { signUp } = await import("@/app/login/actions");
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    await signUp({}, form(creds));
    expect(auth.signUp.mock.calls[0]![0].options).not.toHaveProperty("captchaToken");
  });
});

describe("wiring that must not drift", () => {
  const root = join(__dirname, "..", "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  it("the form renders the widget and posts its token for every protected form", () => {
    const src = read("src/components/auth/auth-form.tsx");
    expect(src).toContain("TurnstileField");
    expect(src).toContain('name="captchaToken"');
    expect(src).toMatch(/formNeedsCaptcha\(fields\)/);
  });

  it("every Supabase call the CAPTCHA covers forwards a token", () => {
    const src = read("src/app/login/actions.ts");
    for (const call of ["signInWithPassword", "signUp", "resetPasswordForEmail"]) {
      const at = src.indexOf(`auth.${call}`);
      expect(at, call).toBeGreaterThan(-1);
      expect(src.slice(Math.max(0, at - 400), at + 400), call).toContain("captcha");
    }
  });

  it("the three pages use the shared form, so none can skip the check", () => {
    for (const page of ["login", "signup", "forgot-password"]) {
      expect(read(`src/app/${page}/page.tsx`), page).toContain("<AuthForm");
    }
  });

  it("the security policy allows Cloudflare's script, frame and connections", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toContain(TURNSTILE_ORIGIN);
    expect(cfg).toMatch(/script-src[^\n]*\$\{turnstile\}/);
    expect(cfg).toMatch(/connect-src[^\n]*\$\{turnstile\}/);
    expect(cfg).toMatch(/frame-src \$\{turnstile\}/);
  });

  it("switches to Cloudflare's compact widget on narrow forms, so it isn't clipped on small phones", () => {
    const src = read("src/components/auth/turnstile-field.tsx");
    expect(src).toMatch(/TURNSTILE_MIN_STANDARD_WIDTH\s*=\s*300/);
    expect(src).toMatch(/clientWidth\s*<\s*TURNSTILE_MIN_STANDARD_WIDTH\s*\?\s*"compact"/);
  });

  it("the widget resets after every submission, because a token is single-use", () => {
    const src = read("src/components/auth/turnstile-field.tsx");
    expect(src).toMatch(/turnstile\.reset\(/);
    expect(read("src/components/auth/auth-form.tsx")).toMatch(/resetSignal=\{state\}/);
  });

  it("the secret key is never referenced by the app", () => {
    for (const f of ["src/lib/auth/captcha.ts", "src/components/auth/turnstile-field.tsx", "src/components/auth/auth-form.tsx", "src/app/login/actions.ts", "next.config.ts"]) {
      expect(read(f), f).not.toMatch(/TURNSTILE_SECRET|CAPTCHA_SECRET/i);
    }
  });
});
