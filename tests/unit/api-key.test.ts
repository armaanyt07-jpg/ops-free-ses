import { describe, expect, it } from "vitest";

import {
  environmentForKey,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  parseBearerToken,
} from "@/lib/crypto/api-key";

describe("generateApiKey", () => {
  it("prefixes production keys with sk_live_", () => {
    expect(generateApiKey("production").secret.startsWith("sk_live_")).toBe(
      true,
    );
  });

  it("prefixes staging keys with sk_test_", () => {
    expect(generateApiKey("staging").secret.startsWith("sk_test_")).toBe(true);
  });

  // The schema declares key_prefix as varchar(16); a longer value would be a
  // runtime insert failure rather than a type error.
  it("emits a stored prefix that fits varchar(16)", () => {
    for (const env of ["staging", "production"] as const) {
      expect(generateApiKey(env).keyPrefix).toHaveLength(16);
    }
  });

  it("carries 256 bits of entropy in the secret", () => {
    const { secret } = generateApiKey("production");
    const random = secret.slice("sk_live_".length);
    // 32 bytes base64url-encoded, unpadded.
    expect(random).toHaveLength(43);
  });

  it("does not repeat across many generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(generateApiKey("production").secret);
    }
    expect(seen.size).toBe(1000);
  });

  it("returns a hash that matches the secret", () => {
    const key = generateApiKey("staging");
    expect(key.keyHash).toBe(hashApiKey(key.secret));
  });

  it("returns a hash that is not the secret", () => {
    const key = generateApiKey("staging");
    expect(key.keyHash).not.toContain(key.secret);
    expect(key.keyHash).toHaveLength(64);
  });

  it("emits a prefix that is a genuine prefix of the secret", () => {
    const key = generateApiKey("production");
    expect(key.secret.startsWith(key.keyPrefix)).toBe(true);
  });
});

describe("hashApiKey", () => {
  it("is deterministic, so a presented key can be looked up by index", () => {
    expect(hashApiKey("sk_live_abc")).toBe(hashApiKey("sk_live_abc"));
  });

  it("differs for keys differing in one character", () => {
    expect(hashApiKey("sk_live_abc")).not.toBe(hashApiKey("sk_live_abd"));
  });
});

describe("parseBearerToken", () => {
  it("extracts a token", () => {
    expect(parseBearerToken("Bearer sk_live_abc")).toBe("sk_live_abc");
  });

  it("accepts any header casing", () => {
    expect(parseBearerToken("bearer sk_live_abc")).toBe("sk_live_abc");
    expect(parseBearerToken("BEARER sk_live_abc")).toBe("sk_live_abc");
  });

  it("tolerates extra whitespace", () => {
    expect(parseBearerToken("  Bearer   sk_live_abc  ")).toBe("sk_live_abc");
  });

  it.each([
    ["missing header", null],
    ["empty header", ""],
    ["bare token", "sk_live_abc"],
    ["wrong scheme", "Basic sk_live_abc"],
    ["scheme only", "Bearer"],
    ["scheme with no token", "Bearer "],
    ["two tokens", "Bearer a b"],
  ])("rejects %s", (_label, header) => {
    expect(parseBearerToken(header)).toBeNull();
  });
});

describe("looksLikeApiKey / environmentForKey", () => {
  it("recognises both environments", () => {
    expect(environmentForKey("sk_live_x")).toBe("production");
    expect(environmentForKey("sk_test_x")).toBe("staging");
  });

  it("rejects anything else", () => {
    expect(looksLikeApiKey("not-a-key")).toBe(false);
    expect(environmentForKey("sk_dev_x")).toBeNull();
  });
});
