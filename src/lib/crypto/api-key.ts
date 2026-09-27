import { createHash, randomBytes } from "node:crypto";
import type { Environment } from "@/db/schema";

/**
 * API key generation and verification.
 *
 * SRS §9: keys are generated with a CSPRNG, stored only as cryptographic
 * hashes, and the secret is displayed exactly once.
 *
 * Format:  sk_live_<43 chars base64url>   (production)
 *          sk_test_<43 chars base64url>   (staging)
 *
 * The random component carries 256 bits of entropy. Because the input is
 * uniformly random and of fixed high entropy, an unsalted SHA-256 is the
 * correct primitive here: there is no dictionary to attack, and the digest must
 * be deterministic so that a presented key can be located by the
 * `api_keys_hash` unique index in a single indexed lookup (SRS §6). A password
 * KDF would be the wrong tool — it cannot be looked up, only compared.
 */
const SECRET_BYTES = 32;

export const KEY_PREFIXES: Record<Environment, string> = {
  production: "sk_live_",
  staging: "sk_test_",
};

export interface GeneratedApiKey {
  /** Full secret. Returned to the caller once and never persisted. */
  secret: string;
  /** Stored, non-secret display prefix (SRS: `key_prefix`, max 16 chars). */
  keyPrefix: string;
  /** Stored digest (SRS: `key_hash`). */
  keyHash: string;
}

export function generateApiKey(environment: Environment): GeneratedApiKey {
  const prefix = KEY_PREFIXES[environment];
  const random = randomBytes(SECRET_BYTES).toString("base64url");
  const secret = `${prefix}${random}`;

  return {
    secret,
    // `sk_live_` + 8 identifying chars = 16, the schema's column width.
    keyPrefix: `${prefix}${random.slice(0, 8)}`,
    keyHash: hashApiKey(secret),
  };
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Extracts a bearer token from an Authorization header.
 * Returns null for a missing, malformed, or non-bearer header.
 */
export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match || !match[1]) return null;

  return match[1];
}

/** Shape check before any database work, to reject obvious garbage cheaply. */
export function looksLikeApiKey(candidate: string): boolean {
  return Object.values(KEY_PREFIXES).some((p) => candidate.startsWith(p));
}

/** Environment implied by a key's prefix, or null if it matches none. */
export function environmentForKey(candidate: string): Environment | null {
  for (const [environment, prefix] of Object.entries(KEY_PREFIXES)) {
    if (candidate.startsWith(prefix)) return environment as Environment;
  }
  return null;
}
