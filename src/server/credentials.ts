import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { awsCredentials, type Environment } from "@/db/schema";
import {
  decryptWithKeyring,
  encryptSecret,
  loadMasterKey,
} from "@/lib/crypto/encryption";
import { serverEnv } from "@/lib/env";
import {
  describeSesAccount,
  type SesAccountSnapshot,
  type SesCredentials,
} from "@/lib/ses/client";

/**
 * AWS credential vault — SRS FR-1.
 *
 * Invariants enforced here:
 *   - the secret access key is encrypted before it reaches the database;
 *   - the secret is never returned to any caller after creation;
 *   - every read and write is scoped by `userId` (tenant ownership);
 *   - credentials are validated against AWS before being marked active.
 *
 * `CredentialSummary` is the only shape that leaves this module towards the UI.
 * It has no field that could carry the secret, which makes accidental exposure
 * a type error rather than a review question.
 */
export interface CredentialSummary {
  id: string;
  environment: Environment;
  accessKeyId: string;
  awsRegion: string;
  sesMaxSendRate: number | null;
  active: boolean;
  lastValidatedAt: Date | null;
  createdAt: Date;
  /** Last GetAccount result: sandbox state and quota. Null if never taken. */
  account: SesAccountSnapshot | null;
}

export interface StoreCredentialInput {
  userId: string;
  environment: Environment;
  accessKeyId: string;
  secretAccessKey: string;
  awsRegion: string;
}

export class CredentialValidationError extends Error {
  readonly providerCode: string;

  constructor(message: string, providerCode: string) {
    super(message);
    this.name = "CredentialValidationError";
    this.providerCode = providerCode;
  }
}

/**
 * Says which half of the problem it is. "Wrong key" and "right key, missing
 * IAM permission" need opposite fixes, and a single generic message sends the
 * user to re-check a key that is actually fine.
 */
const INVALID_KEY = new Set([
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "SignatureDoesNotMatch",
  "InvalidAccessKeyId",
  "ExpiredToken",
  "ExpiredTokenException",
]);

function awsErrorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "UnknownError";
}

function validationMessage(providerCode: string): string {
  if (providerCode === "AccessDeniedException" || providerCode === "AccessDenied") {
    return "AWS accepted these keys, but the IAM user is not allowed to call ses:GetAccount. Attach a policy allowing ses:GetAccount, ses:SendEmail, ses:CreateEmailIdentity and ses:GetEmailIdentity, then save again.";
  }
  if (providerCode === "SignatureDoesNotMatch") {
    return "AWS recognised the access key ID, but the secret access key does not match it. Re-copy the secret.";
  }
  if (INVALID_KEY.has(providerCode)) {
    return "AWS does not recognise this access key ID. Check it was copied fully and has not been deleted or deactivated in IAM.";
  }
  return `AWS rejected these credentials (${providerCode}). Check the access key, secret and region.`;
}

function masterKey() {
  return loadMasterKey(serverEnv().ENCRYPTION_KEY);
}

/** Current key first, then the previous one during a rotation. */
export function keyring(): Buffer[] {
  const env = serverEnv();
  return [
    loadMasterKey(env.ENCRYPTION_KEY),
    ...(env.ENCRYPTION_KEY_PREVIOUS ? [loadMasterKey(env.ENCRYPTION_KEY_PREVIOUS)] : []),
  ];
}

/**
 * Re-encrypts every stored credential under the current key — the second half
 * of a key rotation. Idempotent: rows already on the current key are skipped.
 * Each row is decrypted with the keyring and re-encrypted with the same
 * tenant/environment binding, then written back only if unchanged since read.
 */
export async function reencryptAllCredentials(): Promise<{ total: number; rotated: number; failed: number }> {
  const db = getDb();
  const rows = await db.select().from(awsCredentials);
  const keys = keyring();
  let rotated = 0;
  let failed = 0;

  for (const row of rows) {
    const aad = { userId: row.userId, environment: row.environment };
    try {
      const { plaintext, keyIndex } = decryptWithKeyring(row.secretAccessKeyCiphertext, keys, aad);
      if (keyIndex === 0) continue;
      const updated = await db
        .update(awsCredentials)
        .set({ secretAccessKeyCiphertext: encryptSecret(plaintext, keys[0]!, aad) })
        .where(
          and(
            eq(awsCredentials.id, row.id),
            eq(awsCredentials.secretAccessKeyCiphertext, row.secretAccessKeyCiphertext),
          ),
        )
        .returning({ id: awsCredentials.id });
      rotated += updated.length;
    } catch {
      failed += 1;
    }
  }

  return { total: rows.length, rotated, failed };
}

function toSummary(row: typeof awsCredentials.$inferSelect): CredentialSummary {
  return {
    id: row.id,
    environment: row.environment,
    accessKeyId: row.accessKeyId,
    awsRegion: row.awsRegion,
    sesMaxSendRate: row.sesMaxSendRate,
    active: row.active,
    lastValidatedAt: row.lastValidatedAt,
    createdAt: row.createdAt,
    account: (row.accountSnapshot as SesAccountSnapshot | null) ?? null,
  };
}

/**
 * Validates a credential against AWS, then stores it encrypted.
 *
 * Validation happens first: an unusable key never reaches the database. The
 * account snapshot is returned so the caller can surface sandbox state and
 * quota without a second AWS round trip.
 */
export async function storeCredential(
  input: StoreCredentialInput,
): Promise<{ credential: CredentialSummary; account: SesAccountSnapshot }> {
  const candidate: SesCredentials = {
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    region: input.awsRegion,
  };

  let account: SesAccountSnapshot;
  try {
    account = await describeSesAccount(candidate);
  } catch (error) {
    const name = awsErrorName(error);
    throw new CredentialValidationError(validationMessage(name), name);
  }

  const ciphertext = encryptSecret(input.secretAccessKey, masterKey(), {
    userId: input.userId,
    environment: input.environment,
  });

  const db = getDb();
  const [row] = await db
    .insert(awsCredentials)
    .values({
      userId: input.userId,
      environment: input.environment,
      accessKeyId: input.accessKeyId,
      secretAccessKeyCiphertext: ciphertext,
      awsRegion: input.awsRegion,
      sesMaxSendRate:
        account.maxSendRate === null ? null : Math.floor(account.maxSendRate),
      active: true,
      lastValidatedAt: new Date(),
      accountSnapshot: account,
    })
    // One credential per (tenant, environment) — `aws_credentials_user_env`.
    // Re-submitting replaces the stored secret, which is how rotation works.
    .onConflictDoUpdate({
      target: [awsCredentials.userId, awsCredentials.environment],
      set: {
        accessKeyId: input.accessKeyId,
        secretAccessKeyCiphertext: ciphertext,
        awsRegion: input.awsRegion,
        sesMaxSendRate:
          account.maxSendRate === null ? null : Math.floor(account.maxSendRate),
        active: true,
        lastValidatedAt: new Date(),
        accountSnapshot: account,
      },
    })
    .returning();

  if (!row) throw new Error("Failed to persist AWS credential");

  return { credential: toSummary(row), account };
}

export async function listCredentials(
  userId: string,
): Promise<CredentialSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(awsCredentials)
    .where(eq(awsCredentials.userId, userId));

  return rows.map(toSummary);
}

export async function setCredentialActive(
  userId: string,
  credentialId: string,
  active: boolean,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(awsCredentials)
    .set({ active })
    // userId in the predicate, not just credentialId: ownership is enforced by
    // the query, so a guessed id from another tenant matches nothing.
    .where(
      and(
        eq(awsCredentials.id, credentialId),
        eq(awsCredentials.userId, userId),
      ),
    )
    .returning({ id: awsCredentials.id });

  return rows.length > 0;
}

export async function deleteCredential(
  userId: string,
  credentialId: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(awsCredentials)
    .where(
      and(
        eq(awsCredentials.id, credentialId),
        eq(awsCredentials.userId, userId),
      ),
    )
    .returning({ id: awsCredentials.id });

  return rows.length > 0;
}

/**
 * Decrypts the active credential for a tenant/environment.
 *
 * Server-only, and the single place a plaintext AWS secret exists in this
 * application. Returns null when no active credential is configured.
 */
export async function loadSesCredentials(
  userId: string,
  environment: Environment,
): Promise<SesCredentials | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(awsCredentials)
    .where(
      and(
        eq(awsCredentials.userId, userId),
        eq(awsCredentials.environment, environment),
        eq(awsCredentials.active, true),
      ),
    )
    .limit(1);

  if (!row) return null;

  const { plaintext: secretAccessKey } = decryptWithKeyring(
    row.secretAccessKeyCiphertext,
    keyring(),
    { userId, environment },
  );

  return {
    accessKeyId: row.accessKeyId,
    secretAccessKey,
    region: row.awsRegion,
  };
}

/**
 * Loads the active credential together with the tenant's SES send rate.
 *
 * The worker needs both in one round trip: the credential to call SES, and the
 * rate to size the token bucket before it does.
 */
export interface DeliveryCredential {
  credentials: SesCredentials;
  /** From AWS `GetAccount`; null when AWS did not report one. */
  maxSendRate: number | null;
}

export async function loadDeliveryCredential(
  userId: string,
  environment: Environment,
): Promise<DeliveryCredential | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(awsCredentials)
    .where(
      and(
        eq(awsCredentials.userId, userId),
        eq(awsCredentials.environment, environment),
        eq(awsCredentials.active, true),
      ),
    )
    .limit(1);

  if (!row) return null;

  const { plaintext: secretAccessKey } = decryptWithKeyring(
    row.secretAccessKeyCiphertext,
    keyring(),
    { userId, environment },
  );

  return {
    credentials: {
      accessKeyId: row.accessKeyId,
      secretAccessKey,
      region: row.awsRegion,
    },
    maxSendRate: row.sesMaxSendRate,
  };
}

/** Re-checks a stored credential against AWS and refreshes its snapshot. */
export async function revalidateCredential(
  userId: string,
  environment: Environment,
): Promise<SesAccountSnapshot | null> {
  const credentials = await loadSesCredentials(userId, environment);
  if (!credentials) return null;

  let account: SesAccountSnapshot;
  try {
    account = await describeSesAccount(credentials);
  } catch (error) {
    const name = awsErrorName(error);
    throw new CredentialValidationError(validationMessage(name), name);
  }

  const db = getDb();
  await db
    .update(awsCredentials)
    .set({
      lastValidatedAt: new Date(),
      sesMaxSendRate:
        account.maxSendRate === null ? null : Math.floor(account.maxSendRate),
      accountSnapshot: account,
    })
    .where(
      and(
        eq(awsCredentials.userId, userId),
        eq(awsCredentials.environment, environment),
      ),
    );

  return account;
}
