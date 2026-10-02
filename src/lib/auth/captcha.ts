/**
 * Bot protection for sign-up, sign-in and password reset (Cloudflare Turnstile).
 *
 * Inert until `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set: no widget, no token
 * forwarded, behaviour unchanged. Switching CAPTCHA on in Supabase (Auth → Bot
 * and Abuse Protection) is a separate step, and must come AFTER this code and
 * the site key are live, because Supabase then requires a token on all three
 * forms. The secret key lives only in the Supabase dashboard, never here.
 *
 * Pure and dependency-free so the forms, the actions and the tests share it.
 */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** The public site key, or undefined when bot protection isn't configured. */
export function turnstileSiteKey(): string | undefined {
  // Direct property access so Next.js can inline it into the client bundle.
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return key ? key : undefined;
}

/** Which auth forms carry the check. Setting a new password (already signed in via the email link) doesn't. */
export function formNeedsCaptcha(fields: "credentials" | "email" | "new-password"): boolean {
  return fields !== "new-password";
}

export type CaptchaResult = { ok: true; token: string | undefined } | { ok: false; error: string };

/**
 * Reads the token the widget put in the form. With a site key configured a
 * missing token is refused here with a clear message, instead of a confusing
 * failure from Supabase. Without a site key nothing is forwarded.
 */
export function readCaptchaToken(formData: FormData): CaptchaResult {
  const key = turnstileSiteKey();
  if (!key) return { ok: true, token: undefined };

  const raw = formData.get("captchaToken");
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) {
    return { ok: false, error: "Please wait for the human check to finish, then try again." };
  }
  return { ok: true, token };
}

/** Shown when Supabase rejects the token (expired, reused or failed). */
export const CAPTCHA_FAILED_MESSAGE = "The human check didn’t pass. Reload the page and try again.";

/** Supabase reports a failed or missing CAPTCHA with this error code. */
export function isCaptchaError(error: { code?: string | undefined } | null | undefined): boolean {
  return error?.code === "captcha_failed";
}
