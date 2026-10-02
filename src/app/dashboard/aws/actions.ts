"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/api/logger";

import {
  CredentialValidationError,
  deleteCredential,
  revalidateCredential,
  setCredentialActive,
  storeCredential,
} from "@/server/credentials";
import { SES_REGION_IDS } from "@/lib/aws/regions";
import { ConnectError, checkConnection, startConnection, type ConnectionState } from "@/server/aws-connect";
import { DASHBOARD_ENVIRONMENT } from "@/server/environment";
import { requireTenant } from "@/server/tenant";

/**
 * AWS credential management — FR-1.
 *
 * Every action re-derives the tenant from the verified session. The client
 * never supplies a user id, so a crafted form post cannot target another
 * tenant's credentials.
 */
const storeSchema = z.object({
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
      environment: DASHBOARD_ENVIRONMENT,
      ...parsed.data,
    });

    log.security("credential.saved", tenant.id, `${DASHBOARD_ENVIRONMENT} ${parsed.data.awsRegion}`);
    revalidatePath("/dashboard/aws");
    revalidatePath("/dashboard");

    const sandbox = account.productionAccessEnabled
      ? "production access enabled"
      : "still in the SES sandbox";

    return {
      success: `Connected to AWS (${parsed.data.awsRegion}) — ${sandbox}.`,
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
export async function revalidate(_prev: RevalidateState): Promise<RevalidateState> {
  const tenant = await requireTenant();

  try {
    const account = await revalidateCredential(tenant.id, DASHBOARD_ENVIRONMENT);
    if (!account) return { error: "No active AWS credential." };
  } catch (error) {
    if (error instanceof CredentialValidationError) return { error: error.message };
    return { error: "AWS could not be reached. Try again shortly." };
  }

  revalidatePath("/dashboard/aws");
  revalidatePath("/dashboard");
  return { ok: true };
}

export type StartConnectResult = { ok: true; connectionId: string; url: string } | { ok: false; error: string };

/**
 * Begins a one-click connection: mints the ExternalId and returns the AWS
 * console link that creates the role. The tenant comes from the session, never
 * from the form.
 */
export async function startAwsConnect(awsRegion: string): Promise<StartConnectResult> {
  const tenant = await requireTenant();
  if (!SES_REGION_IDS.includes(awsRegion)) return { ok: false, error: "Choose one of the listed regions." };

  try {
    const started = await startConnection(tenant.id, DASHBOARD_ENVIRONMENT, awsRegion, tenant.email);
    return { ok: true, ...started };
  } catch (error) {
    if (error instanceof ConnectError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not start the connection. Try again shortly." };
  }
}

/** Polled by the connect button until the role is proven or the attempt fails. */
export async function pollAwsConnect(connectionId: string): Promise<ConnectionState> {
  const tenant = await requireTenant();
  const id = z.string().uuid().safeParse(connectionId);
  if (!id.success) return { state: "failed", message: "That connection attempt was not found. Start again." };

  const state = await checkConnection(tenant.id, id.data);
  if (state.state === "connected") {
    revalidatePath("/dashboard/aws");
    revalidatePath("/dashboard");
  }
  return state;
}
