"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { normaliseRecipients } from "@/lib/api/send-schema";
import { getActiveEnvironment, isEnvironment, setActiveEnvironment } from "@/server/environment";
import { checkLimit } from "@/server/abuse";
import { acceptSend } from "@/server/send-service";
import { requireTenant } from "@/server/tenant";

/** Environment switcher. A view preference only — see src/server/environment.ts. */
export async function switchEnvironment(formData: FormData): Promise<void> {
  await requireTenant();
  const env = formData.get("environment");
  if (!isEnvironment(env)) return;
  await setActiveEnvironment(env);
  revalidatePath("/dashboard", "layout");
}

/**
 * Test send from the dashboard — the Phase 4 exit criterion "a developer can
 * … send email" through the dashboard.
 *
 * Goes through `acceptSend`, the same function as `POST /api/v1/send`:
 * suppression check, durable log, durable enqueue. It is a real send in the
 * active environment, not a simulation, and shows up in Activity like any
 * other message. Deliberately small — one recipient, plain text — because it
 * exists to prove the pipeline, not to replace the API.
 */
const testSendSchema = z.object({
  from: z.string().trim().email("Enter a valid sender address").max(320),
  to: z.string().trim().email("Enter a valid recipient address").max(320),
  subject: z.string().trim().min(1, "Add a subject").max(998),
  text: z.string().trim().min(1, "Add a message").max(10_000),
});

export interface TestSendState {
  error?: string;
  sent?: { logId: string; environment: string };
}

export async function sendTestEmail(
  _prev: TestSendState,
  formData: FormData,
): Promise<TestSendState> {
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);

  // Phase 7: test sends are real sends; bound them per tenant (10/minute).
  const limit = await checkLimit("testSend", tenant.id);
  if (!limit.allowed) {
    return { error: `Too many test sends. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` };
  }

  const parsed = testSendSchema.safeParse({
    from: formData.get("from"),
    to: formData.get("to"),
    subject: formData.get("subject"),
    text: formData.get("text"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const result = await acceptSend({
    userId: tenant.id,
    environment,
    requestId: `dash_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    from: parsed.data.from,
    to: normaliseRecipients([parsed.data.to]),
    subject: parsed.data.subject,
    text: parsed.data.text,
    tags: { source: "dashboard-test" },
  });

  if (!result.ok) {
    switch (result.reason) {
      case "suppressed":
        return {
          error: `${result.suppressed.join(", ")} is on the suppression list, so nothing was sent.`,
        };
      case "unavailable":
        return {
          error: "The queue did not accept the message. Check System health and try again.",
        };
      case "idempotency_conflict":
        return { error: "Unexpected idempotency conflict." };
    }
  }

  revalidatePath("/dashboard", "layout");
  return { sent: { logId: result.logId, environment } };
}
