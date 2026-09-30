"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/api/logger";

import {
  checkDomainIfStale,
  DomainError,
  onboardDomain,
  removeDomain,
  scheduleDomainPolling,
} from "@/server/domains";
import {
  addEmailIdentity,
  checkEmailIdentity,
  EmailIdentityError,
  removeEmailIdentity,
} from "@/server/email-identities";
import { DASHBOARD_ENVIRONMENT } from "@/server/environment";
import { requireTenant } from "@/server/tenant";

/**
 * Domain management — FR-2.
 *
 * As with every dashboard action, the tenant comes from the verified session;
 * a form can name a domain id but never a user id.
 */
const addSchema = z.object({
  domain: z.string().trim().min(1, "Enter a domain").max(253),
});

export interface DomainFormState {
  error?: string;
  success?: string;
}

export async function addDomain(
  _prev: DomainFormState,
  formData: FormData,
): Promise<DomainFormState> {
  const tenant = await requireTenant();

  const parsed = addSchema.safeParse({
    domain: formData.get("domain"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the domain." };
  }

  try {
    const view = await onboardDomain({ userId: tenant.id, environment: DASHBOARD_ENVIRONMENT, ...parsed.data });
    log.security("domain.added", tenant.id, `${view.domain} ${view.environment}`);
    revalidatePath("/dashboard", "layout");

    let success: string;
    if (view.status === "verified") {
      success = `${view.domain} is already verified in SES (${view.region}).`;
    } else if (view.autoDns.status === "published") {
      success = `${view.domain} was created in SES (${view.region}) and its DKIM records were added to your Route 53 zone ${view.autoDns.zone}. Verification usually completes within minutes and is checked automatically.`;
    } else {
      success = `${view.domain} was created in SES (${view.region}). Add the DNS records below at your DNS provider — verification is checked automatically.`;
    }
    return { success };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "The domain could not be added." };
  }
}

const idSchema = z.string().uuid();

export async function checkDomainNow(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;

  const result = await checkDomainIfStale(tenant.id, id.data);

  // Pressing "Check now" after the poller has given up arms a new round.
  if (result?.view.status === "pending") {
    await scheduleDomainPolling({ id: id.data, userId: tenant.id });
  }

  revalidatePath("/dashboard", "layout");
}

export async function deleteDomain(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;

  if (await removeDomain(tenant.id, id.data)) log.security("domain.removed", tenant.id, id.data);
  revalidatePath("/dashboard", "layout");
}

// ---------------------------------------------------------------------------
// Email-address identities (Phase 8)
// ---------------------------------------------------------------------------

const addEmailSchema = z.object({
  email: z.string().trim().min(1, "Enter an email address").max(320),
});

export async function addEmailIdentityAction(
  _prev: DomainFormState,
  formData: FormData,
): Promise<DomainFormState> {
  const tenant = await requireTenant();

  const parsed = addEmailSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the address." };
  }
  try {
    const row = await addEmailIdentity({ userId: tenant.id, environment: DASHBOARD_ENVIRONMENT, ...parsed.data });
    log.security("email_identity.added", tenant.id, `${row.email} ${row.environment}`);
    revalidatePath("/dashboard", "layout");
    return {
      success:
        row.status === "verified"
          ? `${row.email} is already verified in SES.`
          : `Amazon sent a confirmation email to ${row.email}. Click the link in it (check spam too), then come back here.`,
    };
  } catch (error) {
    if (error instanceof EmailIdentityError) return { error: error.message };
    return { error: "The address could not be added." };
  }
}

export async function checkEmailIdentityNow(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await checkEmailIdentity(tenant.id, id.data);
  revalidatePath("/dashboard", "layout");
}

export async function deleteEmailIdentity(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  if (await removeEmailIdentity(tenant.id, id.data)) {
    log.security("email_identity.removed", tenant.id, id.data);
  }
  revalidatePath("/dashboard", "layout");
}
