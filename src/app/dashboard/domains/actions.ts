"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/api/logger";

import { environmentEnum } from "@/db/schema";
import {
  checkDomainIfStale,
  DomainError,
  onboardDomain,
  removeDomain,
  scheduleDomainPolling,
} from "@/server/domains";
import { requireTenant } from "@/server/tenant";

/**
 * Domain management — FR-2.
 *
 * As with every dashboard action, the tenant comes from the verified session;
 * a form can name a domain id but never a user id.
 */
const addSchema = z.object({
  domain: z.string().trim().min(1, "Enter a domain").max(253),
  environment: z.enum(environmentEnum.enumValues),
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
    environment: formData.get("environment"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the domain." };
  }

  try {
    const view = await onboardDomain({ userId: tenant.id, ...parsed.data });
    log.security("domain.added", tenant.id, `${view.domain} ${view.environment}`);
    revalidatePath("/dashboard/domains");

    return {
      success:
        view.status === "verified"
          ? `${view.domain} is already verified in SES (${view.region}).`
          : `${view.domain} was created in SES (${view.region}). Publish the DNS records below — verification is checked automatically.`,
    };
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

  revalidatePath("/dashboard/domains");
}

export async function deleteDomain(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;

  if (await removeDomain(tenant.id, id.data)) log.security("domain.removed", tenant.id, id.data);
  revalidatePath("/dashboard/domains");
}
