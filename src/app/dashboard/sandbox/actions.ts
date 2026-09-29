"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/api/logger";

import { draftSchema, missingAnswers } from "@/lib/sandbox/request";
import { getActiveEnvironment } from "@/server/environment";
import { markReviewed, ReviewError, saveDraft } from "@/server/sandbox";
import { requireTenant } from "@/server/tenant";

/**
 * Sandbox-exit assistant actions. The environment is the active one — the
 * SES account whose sandbox is being exited — and the tenant comes from the
 * session. Nothing here talks to AWS.
 */
export interface SaveDraftState {
  error?: string;
  savedAt?: string;
  missing?: string[];
}

export async function saveSandboxDraft(_prev: SaveDraftState, formData: FormData): Promise<SaveDraftState> {
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("draft") ?? "{}"));
  } catch {
    return { error: "The form could not be read." };
  }
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `${issue?.path.join(".") || "Answer"}: ${issue?.message ?? "invalid"}` };
  }

  await saveDraft(tenant.id, environment, parsed.data);
  revalidatePath("/dashboard/sandbox");
  return { savedAt: new Date().toISOString(), missing: missingAnswers(parsed.data) };
}

export interface ReviewState {
  error?: string;
  ok?: boolean;
}

const reviewSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  accurate: z.literal("on", { message: "Confirm every statement is accurate." }),
  estimates: z.literal("on", { message: "Confirm the numbers are your own estimates." }),
  awsDecides: z.literal("on", { message: "Confirm you understand AWS makes the decision." }),
});

export async function reviewSandboxRequest(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);

  const parsed = reviewSchema.safeParse({
    hash: formData.get("hash"),
    accurate: formData.get("accurate"),
    estimates: formData.get("estimates"),
    awsDecides: formData.get("awsDecides"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Confirm each item." };

  try {
    await markReviewed(tenant.id, environment, tenant.email, parsed.data.hash);
    log.security("sandbox_request.reviewed", tenant.id, environment);
  } catch (error) {
    if (error instanceof ReviewError) return { error: error.message };
    throw error;
  }
  revalidatePath("/dashboard/sandbox");
  return { ok: true };
}
