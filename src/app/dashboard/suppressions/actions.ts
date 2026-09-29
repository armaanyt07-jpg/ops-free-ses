"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/api/logger";

import {
  addSuppression,
  removeSuppression,
  SuppressionChangeError,
} from "@/server/suppression";
import { requireTenant } from "@/server/tenant";

/**
 * Manual suppression changes — SRS §11: "explicit and auditable".
 *
 * Both require a written reason, and the tenant's identity (the actor recorded
 * in `audit_logs`) comes from the verified session, never from the form.
 */
const changeSchema = z.object({
  email: z.string().trim().min(3, "Enter an email address").max(320),
  note: z
    .string()
    .trim()
    .min(3, "Say why — this is recorded in the audit log")
    .max(500),
});

export interface SuppressionFormState {
  error?: string;
  success?: string;
}

async function change(
  kind: "add" | "remove",
  formData: FormData,
): Promise<SuppressionFormState> {
  const tenant = await requireTenant();
  const parsed = changeSchema.safeParse({
    email: formData.get("email"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  try {
    const input = { userId: tenant.id, actor: tenant.email, ...parsed.data };
    const row = kind === "add" ? await addSuppression(input) : await removeSuppression(input);
    log.security(`suppression.${kind === "add" ? "added" : "removed"}`, tenant.id, "manual change; see audit_logs");
    revalidatePath("/dashboard/suppressions");
    return {
      success:
        kind === "add"
          ? `${row.email} is now suppressed.`
          : `${row.email} can receive email again.`,
    };
  } catch (error) {
    if (error instanceof SuppressionChangeError) return { error: error.message };
    return { error: "The change could not be saved." };
  }
}

export async function addSuppressionAction(
  _prev: SuppressionFormState,
  formData: FormData,
): Promise<SuppressionFormState> {
  return change("add", formData);
}

export async function removeSuppressionAction(
  _prev: SuppressionFormState,
  formData: FormData,
): Promise<SuppressionFormState> {
  return change("remove", formData);
}
