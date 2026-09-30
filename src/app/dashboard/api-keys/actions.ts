"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/api/logger";

import {
  createApiKey,
  revokeApiKey,
  rotateApiKey,
  ROTATION_GRACE_OPTIONS,
  type RotationGrace,
} from "@/server/api-keys";
import { DASHBOARD_ENVIRONMENT } from "@/server/environment";
import { requireTenant } from "@/server/tenant";

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the key a name").max(120),
});

export interface ApiKeyFormState {
  error?: string;
  /**
   * The generated secret, returned to the browser exactly once so the user can
   * copy it. It is not persisted anywhere and cannot be retrieved again.
   */
  secret?: string;
}

export async function createKey(
  _prev: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const tenant = await requireTenant();

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Check the values you entered." };
  }

  const created = await createApiKey(
    tenant.id,
    parsed.data.name,
    DASHBOARD_ENVIRONMENT,
  );

  log.security("api_key.created", tenant.id, `${created.summary.id} ${created.summary.environment}`);
  revalidatePath("/dashboard/api-keys");

  return { secret: created.secret };
}

export async function revokeKey(formData: FormData): Promise<void> {
  const tenant = await requireTenant();

  const keyId = z.string().uuid().safeParse(formData.get("id"));
  if (!keyId.success) return;

  if (await revokeApiKey(tenant.id, keyId.data)) {
    log.security("api_key.revoked", tenant.id, keyId.data);
  }
  revalidatePath("/dashboard/api-keys");
}

export interface RotateKeyState {
  error?: string;
  /** The replacement's secret — shown once, like any new key. */
  secret?: string;
  oldKeyExpiresAt?: string;
  immediate?: boolean;
}

export async function rotateKey(
  _prev: RotateKeyState,
  formData: FormData,
): Promise<RotateKeyState> {
  const tenant = await requireTenant();

  const keyId = z.string().uuid().safeParse(formData.get("id"));
  const grace = formData.get("grace");
  if (!keyId.success || typeof grace !== "string" || !(grace in ROTATION_GRACE_OPTIONS)) {
    return { error: "Invalid rotation request." };
  }

  const rotated = await rotateApiKey(tenant.id, keyId.data, grace as RotationGrace);
  if (!rotated) {
    return { error: "That key is no longer active, so it cannot be rotated." };
  }

  log.security("api_key.rotated", tenant.id, `${keyId.data} -> ${rotated.summary.id} grace=${grace}`);
  revalidatePath("/dashboard/api-keys");
  return {
    secret: rotated.secret,
    oldKeyExpiresAt: rotated.oldKeyExpiresAt.toISOString(),
    immediate: grace === "now",
  };
}
