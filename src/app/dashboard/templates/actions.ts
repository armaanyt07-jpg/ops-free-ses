"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { log } from "@/lib/api/logger";

import { normaliseRecipients } from "@/lib/api/send-schema";
import type { Issue } from "@/lib/templates/engine";
import { getActiveEnvironment } from "@/server/environment";
import { checkLimit } from "@/server/abuse";
import { acceptSend } from "@/server/send-service";
import {
  createTemplate,
  renderTemplateForSend,
  restoreVersion,
  setTemplateActive,
  TemplateError,
  updateTemplate,
  variablesSchema,
} from "@/server/templates";
import { requireTenant } from "@/server/tenant";

/**
 * Template management — FR-6. The tenant always comes from the session.
 * Content is validated again on the server whatever the editor showed: the
 * browser's live validation is a convenience, not the gate.
 */
export interface SaveTemplateState {
  error?: string;
  issues?: Issue[];
  saved?: { version: number; newVersion: boolean; at: string };
}

const contentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  variables: z.string(),
});

export async function saveTemplate(
  _prev: SaveTemplateState,
  formData: FormData,
): Promise<SaveTemplateState> {
  const tenant = await requireTenant();

  const parsed = contentSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    subject: formData.get("subject") ?? "",
    html: formData.get("html") ?? "",
    text: formData.get("text") ?? "",
    variables: formData.get("variables") ?? "[]",
  });
  if (!parsed.success) return { error: "The form was incomplete." };

  let variables;
  try {
    const v = variablesSchema.safeParse(JSON.parse(parsed.data.variables));
    if (!v.success) return { error: v.error.issues[0]?.message ?? "Invalid variables." };
    variables = v.data;
  } catch {
    return { error: "Invalid variables." };
  }

  const content = {
    name: parsed.data.name,
    subject: parsed.data.subject,
    html: parsed.data.html,
    text: parsed.data.text.trim() ? parsed.data.text : null,
    variables,
  };

  let createdId: string | null = null;
  try {
    if (parsed.data.id) {
      const { template, newVersion } = await updateTemplate(tenant.id, tenant.email, parsed.data.id, content);
      revalidatePath("/dashboard/templates");
      revalidatePath(`/dashboard/templates/${template.id}`);
      return { saved: { version: template.version, newVersion, at: new Date().toISOString() } };
    }
    createdId = (await createTemplate(tenant.id, tenant.email, content)).id;
  } catch (error) {
    if (error instanceof TemplateError) return { error: error.message, issues: error.issues };
    return { error: "The template could not be saved." };
  }

  revalidatePath("/dashboard/templates");
  redirect(`/dashboard/templates/${createdId}?created=1`);
}

export async function restoreTemplateVersion(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const version = z.coerce.number().int().min(1).safeParse(formData.get("version"));
  if (!id.success || !version.success) return;

  try {
    await restoreVersion(tenant.id, tenant.email, id.data, version.data);
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
  }
  revalidatePath(`/dashboard/templates/${id.data}`);
  redirect(`/dashboard/templates/${id.data}`);
}

export async function setTemplateArchived(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const archived = formData.get("archived") === "true";
  if (await setTemplateActive(tenant.id, id.data, !archived)) {
    log.security(archived ? "template.archived" : "template.unarchived", tenant.id, id.data);
  }
  revalidatePath("/dashboard/templates");
  revalidatePath(`/dashboard/templates/${id.data}`);
}

// ---------------------------------------------------------------------------
// Test send — FR-6 "test-send workflow"
// ---------------------------------------------------------------------------

export interface TemplateTestState {
  error?: string;
  details?: string[];
  sent?: { logId: string; version: number; environment: string };
}

const testSchema = z.object({
  id: z.string().uuid(),
  from: z.string().trim().email("Enter a valid sender address"),
  to: z.string().trim().email("Enter a valid recipient address"),
  variables: z.string(),
});

/**
 * Renders the **saved** current version with the given values and sends it
 * through the same pipeline as the API — suppression, log, queue, worker. The
 * log records the template id and version, exactly as an API send would.
 */
export async function sendTemplateTest(
  _prev: TemplateTestState,
  formData: FormData,
): Promise<TemplateTestState> {
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);

  // Phase 7: test sends are real sends; bound them per tenant (10/minute).
  const limit = await checkLimit("testSend", tenant.id);
  if (!limit.allowed) {
    return { error: `Too many test sends. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` };
  }

  const parsed = testSchema.safeParse({
    id: formData.get("id"),
    from: formData.get("from"),
    to: formData.get("to"),
    variables: formData.get("variables") ?? "{}",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  let values: Record<string, unknown>;
  try {
    values = z.record(z.string(), z.unknown()).parse(JSON.parse(parsed.data.variables));
  } catch {
    return { error: "Variables must be a JSON object." };
  }

  const rendered = await renderTemplateForSend(tenant.id, parsed.data.id, values);
  if (!rendered.ok) {
    return {
      error: rendered.message,
      details: rendered.reason === "invalid_variables" ? rendered.errors : undefined,
    };
  }

  const result = await acceptSend({
    userId: tenant.id,
    environment,
    requestId: `dash_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    from: parsed.data.from,
    to: normaliseRecipients([parsed.data.to]),
    subject: rendered.rendered.subject,
    html: rendered.rendered.html,
    text: rendered.rendered.text,
    tags: { source: "template-test" },
    templateId: rendered.templateId,
    templateVersion: rendered.version,
  });

  if (!result.ok) {
    if (result.reason === "suppressed") {
      return { error: `${result.suppressed.join(", ")} is on the suppression list, so nothing was sent.` };
    }
    return { error: "The queue did not accept the message. Check Sending status and try again." };
  }

  revalidatePath("/dashboard", "layout");
  return { sent: { logId: result.logId, version: rendered.version, environment } };
}
