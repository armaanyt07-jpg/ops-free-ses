import "server-only";

import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import { getDb } from "@/db";
import { apiKeys, type Environment } from "@/db/schema";
import {
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
} from "@/lib/crypto/api-key";

/**
 * API key lifecycle — SRS FR-3 / §9.
 *
 * The plaintext secret exists only inside `createApiKey`'s return value. It is
 * never persisted, never logged, and cannot be recovered afterwards.
 */
export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  environment: Environment;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreatedApiKey {
  summary: ApiKeySummary;
  /** Shown to the user exactly once, at creation. */
  secret: string;
}

function toSummary(row: typeof apiKeys.$inferSelect): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    environment: row.environment,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export async function createApiKey(
  userId: string,
  name: string,
  environment: Environment,
  expiresAt: Date | null = null,
): Promise<CreatedApiKey> {
  const generated = generateApiKey(environment);

  const db = getDb();
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId,
      name,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      environment,
      expiresAt,
    })
    .returning();

  if (!row) throw new Error("Failed to persist API key");

  return { summary: toSummary(row), secret: generated.secret };
}

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));

  return rows.map(toSummary);
}

/** Revocation is irreversible and idempotent; the row is kept for audit. */
export async function revokeApiKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, keyId),
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });

  return rows.length > 0;
}

/**
 * Rotation: issue a replacement with the same name and environment, and give
 * the old key a deadline instead of killing it on the spot.
 *
 * Revoking immediately would make rotation an outage — every service using the
 * old key fails until it is redeployed with the new one. The overlap window
 * (`expires_at`, which authentication already enforces) lets the new key be
 * rolled out first. `graceMs = 0` still means "stop now".
 *
 * Only an active, unexpired key can be rotated, and only by its owner.
 */
export const ROTATION_GRACE_OPTIONS = {
  now: 0,
  "1h": 3600 * 1000,
  "24h": 24 * 3600 * 1000,
  "7d": 7 * 24 * 3600 * 1000,
} as const;

export type RotationGrace = keyof typeof ROTATION_GRACE_OPTIONS;

export interface RotatedApiKey extends CreatedApiKey {
  /** When the replaced key stops authenticating. */
  oldKeyExpiresAt: Date;
}

export async function rotateApiKey(
  userId: string,
  keyId: string,
  grace: RotationGrace,
): Promise<RotatedApiKey | null> {
  const now = new Date();
  const deadline = new Date(now.getTime() + ROTATION_GRACE_OPTIONS[grace]);

  return getDb().transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.id, keyId),
          eq(apiKeys.userId, userId),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
        ),
      )
      .limit(1)
      .for("update");

    if (!old) return null;

    const generated = generateApiKey(old.environment);
    const [row] = await tx
      .insert(apiKeys)
      .values({
        userId,
        name: old.name,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        environment: old.environment,
      })
      .returning();
    if (!row) throw new Error("Failed to persist rotated API key");

    // Never extend an existing, earlier deadline.
    const oldKeyExpiresAt =
      old.expiresAt && old.expiresAt < deadline ? old.expiresAt : deadline;

    await tx
      .update(apiKeys)
      .set(
        grace === "now"
          ? { revokedAt: now }
          : { expiresAt: oldKeyExpiresAt },
      )
      .where(eq(apiKeys.id, old.id));

    return {
      summary: toSummary(row),
      secret: generated.secret,
      oldKeyExpiresAt: grace === "now" ? now : oldKeyExpiresAt,
    };
  });
}

export type AuthFailureReason =
  | "malformed"
  | "unknown_key"
  | "revoked"
  | "expired";

export interface AuthenticatedKey {
  keyId: string;
  userId: string;
  environment: Environment;
}

export type ApiKeyAuthResult =
  | { ok: true; key: AuthenticatedKey }
  | { ok: false; reason: AuthFailureReason };

/**
 * Resolves a presented secret to its owning tenant.
 *
 * Every failure mode returns the same opaque outcome to the caller, which
 * responds with a single UNAUTHORIZED message — the distinction is for logs,
 * not for the client, so a probing caller learns nothing about which keys
 * exist.
 */
export async function authenticateApiKey(
  secret: string,
): Promise<ApiKeyAuthResult> {
  if (!looksLikeApiKey(secret)) {
    return { ok: false, reason: "malformed" };
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(apiKeys)
    // Indexed equality on the digest of the presented key. The stored value is
    // a hash, so a database leak does not yield usable credentials.
    .where(eq(apiKeys.keyHash, hashApiKey(secret)))
    .limit(1);

  if (!row) return { ok: false, reason: "unknown_key" };
  if (row.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    key: {
      keyId: row.id,
      userId: row.userId,
      environment: row.environment,
    },
  };
}

/**
 * Records key usage. Deliberately fire-and-forget at the call site: a failure
 * to update this timestamp must never fail an otherwise valid send.
 */
export async function touchApiKey(keyId: string): Promise<void> {
  const db = getDb();
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyId));
}
