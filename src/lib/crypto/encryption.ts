import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Authenticated encryption for stored AWS secret access keys.
 *
 * SRS §9: "Encrypt AWS secret keys with AES-256-GCM or equivalent authenticated
 * encryption." NFR: AES-256 authenticated encryption is mandatory.
 *
 * Ciphertext envelope (base64 of the concatenation):
 *
 *   [ version:1 ][ iv:12 ][ authTag:16 ][ ciphertext:n ]
 *
 * The version byte lets a later phase rotate the master key or algorithm
 * without ambiguity about how an existing row was written.
 *
 * Additional Authenticated Data binds each ciphertext to the tenant and
 * environment it belongs to, so a row copied between tenants or between
 * staging and production fails to decrypt rather than silently working.
 */
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ALGORITHM = "aes-256-gcm";

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

export interface CredentialAad {
  userId: string;
  environment: string;
}

function aadBuffer(aad: CredentialAad): Buffer {
  return Buffer.from(`v${VERSION}:${aad.userId}:${aad.environment}`, "utf8");
}

/**
 * Decodes and validates the master key. Accepts base64 or base64url; requires
 * exactly 32 bytes so a truncated or mistyped key fails loudly at the boundary
 * rather than weakening encryption silently.
 */
export function loadMasterKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  let key: Buffer;

  try {
    key = Buffer.from(trimmed, "base64");
  } catch {
    throw new Error("ENCRYPTION_KEY is not valid base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }

  return key;
}

export function encryptSecret(
  plaintext: string,
  masterKey: Buffer,
  aad: CredentialAad,
): string {
  if (plaintext.length === 0) {
    throw new Error("Refusing to encrypt an empty secret");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  cipher.setAAD(aadBuffer(aad));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([
    Buffer.from([VERSION]),
    iv,
    authTag,
    ciphertext,
  ]).toString("base64");
}

export function decryptSecret(
  envelope: string,
  masterKey: Buffer,
  aad: CredentialAad,
): string {
  let raw: Buffer;
  try {
    raw = Buffer.from(envelope, "base64");
  } catch {
    throw new DecryptionError("Ciphertext is not valid base64");
  }

  if (raw.length < 1 + IV_BYTES + TAG_BYTES + 1) {
    throw new DecryptionError("Ciphertext envelope is truncated");
  }

  const version = raw[0];
  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported ciphertext version: ${version}`);
  }

  const iv = raw.subarray(1, 1 + IV_BYTES);
  const authTag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(1 + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAAD(aadBuffer(aad));
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM tag mismatch: wrong key, wrong tenant/environment, or tampering.
    // The reason is deliberately not distinguished to the caller.
    throw new DecryptionError(
      "Unable to decrypt stored credential — authentication failed",
    );
  }
}

/** Constant-time comparison for equal-length secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
