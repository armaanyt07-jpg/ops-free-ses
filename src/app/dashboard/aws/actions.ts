"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/api/logger";

import { environmentEnum } from "@/db/schema";
import {
  CredentialValidationError,
  deleteCredential,
  revalidateCredential,
  setCredentialActive,
  storeCredential,
} from "@/server/credentials";
import { requireTenant } from "@/server/tenant";

/**
 * AWS credential management — FR-1.
 *
 * Every action re-derives the tenant from the verified session. The client
 * never supplies a user id, so a crafted form post cannot target another
 * tenant's credentials.
 */
const storeSchema = z.object({
  environment: z.enum(environmentEnum.enumValues),
  // AWS access key ids are 16–128 uppercase alphanumerics in practice.
  accessKeyId: z
    .string()
    .trim()
    .min(16, "Access key ID looks too short")
    .max(128),
  secretAccessKey: z
    .string()
    .trim()
    .min(16, "Secret access key looks too short")
    .max(256),
  awsRegion: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9-]+$/, "Region must look like us-east-1"),
});

export interface CredentialFormState {
  error?: string;
  success?: string;
}

export async function saveCredential(
  _prev: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  const tenant = await requireTenant();

  const parsed = storeSchema.safeParse({
    environment: formData.get("environment"),
    accessKeyId: formData.get("accessKeyId"),
    secretAccessKey: formData.get("secretAccessKey"),
    awsRegion: formData.get("awsRegion"),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Check the values you entered." };
  }

  try {
    const { account } = await storeCredential({
      userId: tenant.id,
      ...parsed.data,
    });

    log.security("credential.saved", tenant.id, `${parsed.data.environment} ${parsed.data.awsRegion}`);
    revalidatePath("/dashboard/aws");
    revalidatePath("/dashboard");

    const sandbox = account.productionAccessEnabled
      ? "production access enabled"
      : "still in the SES sandbox";

    return {
      success: `Credential validated and stored for ${parsed.data.environment} — ${sandbox}.`,
    };
  } catch (error) {
    if (error instanceof CredentialValidationError) {
      return { error: error.message };
    }
    // The secret is in scope in this function; never let an unexpected error
    // message reach the client, in case it quotes the input.
    return { error: "The credential could not be stored." };
  }
}

export async function toggleCredential(formData: FormData): Promise<void> {
  const tenant = await requireTenant();

  const credentialId = z.string().uuid().safeParse(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!credentialId.success) return;

  if (await setCredentialActive(tenant.id, credentialId.data, active)) {
    log.security(active ? "credential.activated" : "credential.revoked", tenant.id, credentialId.data);
  }
  revalidatePath("/dashboard/aws");
}

export async function removeCredential(formData: FormData): Promise<void> {
  const tenant = await requireTenant();

  const credentialId = z.string().uuid().safeParse(formData.get("id"));
  if (!credentialId.success) return;

  if (await deleteCredential(tenant.id, credentialId.data)) {
    log.security("credential.deleted", tenant.id, credentialId.data);
  }
  revalidatePath("/dashboard/aws");
}

export interface RevalidateState {
  error?: string;
  ok?: boolean;
}

/** Re-runs GetAccount and refreshes the stored quota and sandbox snapshot. */
export async function revalidate(
  _prev: RevalidateState,
  formData: FormData,
): Promise<RevalidateState> {
  const tenant = await requireTenant();
  const environment = z.enum(environmentEnum.enumValues).safeParse(formData.get("environment"));
  if (!environment.success) return { error: "Unknown environment." };

  try {
    const account = await revalidateCredential(tenant.id, environment.data);
    if (!account) return { error: "No active credential for this environment." };
  } catch (error) {
    if (error instanceof CredentialValidationError) return { error: error.message };
    return { error: "AWS could not be reached. Try again shortly." };
  }

  revalidatePath("/dashboard/aws");
  revalidatePath("/dashboard");
  return { ok: true };
}
