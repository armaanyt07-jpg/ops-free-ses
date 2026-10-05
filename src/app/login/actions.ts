"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/api/logger";
import { CAPTCHA_FAILED_MESSAGE, isCaptchaError, readCaptchaToken } from "@/lib/auth/captcha";
import { NEW_PASSWORD_MESSAGE, newPasswordSchema } from "@/lib/auth/password-rules";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/server/public-url";

const emailSchema = z.string().email("Enter a valid email address");
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

/** Sign-up: a new password must meet the full rules (see password-rules.ts). */
const signUpSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
});

/** Where auth emails send the user back to: `/auth/confirm`, then `next`. */
async function confirmUrl(next: string): Promise<string> {
  const { origin } = await appOrigin();
  return `${origin}/auth/confirm?next=${encodeURIComponent(next)}`;
}

export interface AuthFormState {
  error?: string;
  notice?: string;
}

/**
 * Failures are reported with a single generic message regardless of cause, so
 * the form cannot be used to enumerate which email addresses have accounts.
 */
export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter a valid email address and password." };
  }

  const captcha = readCaptchaToken(formData);
  if (!captcha.ok) return { error: captcha.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    ...parsed.data,
    ...(captcha.token ? { options: { captchaToken: captcha.token } } : {}),
  });

  if (error) {
    if (isCaptchaError(error)) return { error: CAPTCHA_FAILED_MESSAGE };
    // The user sees one generic message; the cause goes to the server log.
    log.warn({
      event: "auth.signin_failed",
      requestId: "auth",
      status: String(error.status ?? ""),
      errorCode: error.code ?? error.name,
    });
    return { error: "Those credentials were not accepted." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Check the details you entered." };
  }

  const captcha = readCaptchaToken(formData);
  if (!captcha.ok) return { error: captcha.error };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      emailRedirectTo: await confirmUrl("/dashboard"),
      ...(captcha.token ? { captchaToken: captcha.token } : {}),
    },
  });

  if (error) {
    if (isCaptchaError(error)) return { error: CAPTCHA_FAILED_MESSAGE };
    log.warn({
      event: "auth.signup_failed",
      requestId: "auth",
      status: String(error.status ?? ""),
      errorCode: error.code ?? error.name,
    });
    if (error.code === "weak_password") return { error: NEW_PASSWORD_MESSAGE };
    return { error: "That account could not be created." };
  }

  // When email confirmation is enabled, Supabase returns a user with no
  // session. The tenant row is created on first authenticated request, not
  // here, so an unconfirmed signup leaves no orphan record.
  if (!data.session) {
    return {
      notice: "Check your inbox to confirm your email address, then sign in.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Sends a password-reset link. The reply is the same whether or not the
 * address has an account, for the same anti-enumeration reason as sign-in.
 */
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: "Enter a valid email address." };
  }

  const captcha = readCaptchaToken(formData);
  if (!captcha.ok) return { error: captcha.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: await confirmUrl("/reset-password"),
    ...(captcha.token ? { captchaToken: captcha.token } : {}),
  });

  if (error) {
    if (isCaptchaError(error)) return { error: CAPTCHA_FAILED_MESSAGE };
    log.warn({
      event: "auth.reset_request_failed",
      requestId: "auth",
      status: String(error.status ?? ""),
      errorCode: error.code ?? error.name,
    });
    // A rate limit is the one failure worth telling the user about: the link
    // will not arrive, and retrying immediately will not help.
    if (error.status === 429) {
      return { error: "Too many reset emails were requested. Wait a few minutes and try again." };
    }
  }

  return {
    notice: "If that address has an account, a reset link is on its way. Open it in this browser.",
  };
}

/**
 * Sets a new password for the signed-in user. Reached from the reset email:
 * `/auth/confirm` has already turned the link into a session.
 */
export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = z
    .object({ password: newPasswordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "The passwords do not match." })
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the password you entered." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    log.warn({
      event: "auth.password_update_failed",
      requestId: "auth",
      status: String(error.status ?? ""),
      errorCode: error.code ?? error.name,
    });
    if (error.code === "same_password") {
      return { error: "Choose a password different from your current one." };
    }
    if (error.code === "weak_password") {
      return { error: NEW_PASSWORD_MESSAGE };
    }
    return { error: "The password could not be changed. Request a new reset link and try again." };
  }

  log.security("password_changed", (await supabase.auth.getUser()).data.user?.id ?? "unknown");
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
