"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Those credentials were not accepted." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Check the details you entered." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);

  if (error) {
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
