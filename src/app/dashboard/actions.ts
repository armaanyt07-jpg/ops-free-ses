"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/api/logger";
import { normaliseRecipients } from "@/lib/api/send-schema";
import { createApiKey } from "@/server/api-keys";
import { getActiveEnvironment } from "@/server/environment";
import { connectEvents, EventsSetupError } from "@/server/events-setup";
import { webhookEndpoint } from "@/server/public-url";
import { checkLimit } from "@/server/abuse";
import { acceptSend } from "@/server/send-service";
import { requireTenant } from "@/server/tenant";

export interface QuickKeyState {
  error?: string;
  /** Shown once, like any new key. */
  secret?: string;
}

/** Setup flow: one click, no form — a key named "Default" in the active environment. */
export async function createQuickKey(_prev: QuickKeyState): Promise<QuickKeyState> {
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);
  const created = await createApiKey(tenant.id, "Default", environment);
  log.security("api_key.created", tenant.id, `${created.summary.id} ${environment}`);
  revalidatePath("/dashboard", "layout");
  return { secret: created.secret };
}

export interface ConnectEventsState {
  error?: string;
  success?: string;
}

export async function connectEventsAction(_prev: ConnectEventsState): Promise<ConnectEventsState> {
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);
  const endpoint = await webhookEndpoint();

  try {
    const result = await connectEvents(tenant.id, environment, endpoint.url);
    log.security("sns_topic.connected", tenant.id, result.topicArn);
    revalidatePath("/dashboard", "layout");
    const domains = result.domains.length > 0 ? ` for ${result.domains.join(", ")}` : "";
    return {
      success: `Connected${domains}. Deliveries, bounces and complaints will now show up in Activity.`,
    };
  } catch (error) {
    if (error instanceof EventsSetupError) return { error: error.message };
    throw error;
  }
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
