import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DecryptionError,
  decryptSecret,
  encryptSecret,
  loadMasterKey,
  safeEqual,
} from "@/lib/crypto/encryption";

const KEY = randomBytes(32);
const AAD = { userId: "11111111-1111-1111-1111-111111111111", environment: "production" };
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

describe("loadMasterKey", () => {
  it("accepts a base64-encoded 32-byte key", () => {
    expect(loadMasterKey(KEY.toString("base64"))).toEqual(KEY);
  });

  it("tolerates surrounding whitespace from a copied .env value", () => {
    expect(loadMasterKey(`  ${KEY.toString("base64")}\n`)).toEqual(KEY);
  });

  it("rejects a key of the wrong length rather than padding it", () => {
    expect(() => loadMasterKey(randomBytes(16).toString("base64"))).toThrow(
      /exactly 32 bytes/,
    );
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", () => {
    const envelope = encryptSecret(SECRET, KEY, AAD);
    expect(decryptSecret(envelope, KEY, AAD)).toBe(SECRET);
  });

  it("never emits the plaintext inside the envelope", () => {
    const envelope = encryptSecret(SECRET, KEY, AAD);
    expect(envelope).not.toContain(SECRET);
    expect(Buffer.from(envelope, "base64").toString("utf8")).not.toContain(
      SECRET,
    );
  });

  it("produces a distinct ciphertext each time (random IV)", () => {
    const a = encryptSecret(SECRET, KEY, AAD);
    const b = encryptSecret(SECRET, KEY, AAD);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY, AAD)).toBe(decryptSecret(b, KEY, AAD));
  });

  it("stamps the envelope with a version byte", () => {
    const raw = Buffer.from(encryptSecret(SECRET, KEY, AAD), "base64");
    expect(raw[0]).toBe(1);
  });

  it("refuses to encrypt an empty secret", () => {
    expect(() => encryptSecret("", KEY, AAD)).toThrow(/empty secret/);
  });

  it("fails under a different master key", () => {
    const envelope = encryptSecret(SECRET, KEY, AAD);
    expect(() => decryptSecret(envelope, randomBytes(32), AAD)).toThrow(
      DecryptionError,
    );
  });

  // The AAD binding is what stops a ciphertext row being useful anywhere
  // other than the exact tenant and environment it was written for.
  it("fails when the tenant does not match", () => {
    const envelope = encryptSecret(SECRET, KEY, AAD);
    expect(() =>
      decryptSecret(envelope, KEY, {
        ...AAD,
        userId: "22222222-2222-2222-2222-222222222222",
      }),
    ).toThrow(DecryptionError);
  });

  it("fails when the environment does not match", () => {
    const envelope = encryptSecret(SECRET, KEY, AAD);
    expect(() =>
      decryptSecret(envelope, KEY, { ...AAD, environment: "staging" }),
    ).toThrow(DecryptionError);
  });

  it("detects a flipped ciphertext bit", () => {
    const raw = Buffer.from(encryptSecret(SECRET, KEY, AAD), "base64");
    const last = raw.length - 1;
    raw.writeUInt8(raw.readUInt8(last) ^ 0x01, last);
    expect(() => decryptSecret(raw.toString("base64"), KEY, AAD)).toThrow(
      DecryptionError,
    );
  });

  it("detects a tampered auth tag", () => {
    const raw = Buffer.from(encryptSecret(SECRET, KEY, AAD), "base64");
    raw.writeUInt8(raw.readUInt8(14) ^ 0xff, 14); // inside the 16-byte tag at offset 13
    expect(() => decryptSecret(raw.toString("base64"), KEY, AAD)).toThrow(
      DecryptionError,
    );
  });

  it("rejects an unknown envelope version", () => {
    const raw = Buffer.from(encryptSecret(SECRET, KEY, AAD), "base64");
    raw[0] = 9;
    expect(() => decryptSecret(raw.toString("base64"), KEY, AAD)).toThrow(
      /Unsupported ciphertext version/,
    );
  });

  it("rejects a truncated envelope", () => {
    expect(() =>
      decryptSecret(randomBytes(8).toString("base64"), KEY, AAD),
    ).toThrow(/truncated/);
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
