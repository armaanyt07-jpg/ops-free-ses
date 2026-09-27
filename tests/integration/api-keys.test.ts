import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  touchApiKey,
} from "@/server/api-keys";
import { hashApiKey } from "@/lib/crypto/api-key";
import { apiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  await resetTestDb();
  userId = await createTestUser("owner@example.test");
  otherUserId = await createTestUser("other@example.test");
});

afterAll(async () => {
  await closeTestDb();
});

describe("createApiKey", () => {
  it("returns the secret exactly once and stores only its hash", async () => {
    const created = await createApiKey(userId, "backend", "production");

    const [stored] = await getDb()
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.summary.id));

    expect(stored?.keyHash).toBe(hashApiKey(created.secret));
    // The plaintext must appear in no column of the row.
    expect(JSON.stringify(stored)).not.toContain(created.secret);
  });

  it("never exposes the secret through the listing API", async () => {
    const created = await createApiKey(userId, "backend", "production");
    const listed = await listApiKeys(userId);

    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect(listed[0]).not.toHaveProperty("keyHash");
  });

  it("scopes the key to the requested environment", async () => {
    const staging = await createApiKey(userId, "staging-key", "staging");
    expect(staging.secret.startsWith("sk_test_")).toBe(true);
    expect(staging.summary.environment).toBe("staging");
  });
});

describe("authenticateApiKey", () => {
  it("resolves a valid key to its owner and environment", async () => {
    const created = await createApiKey(userId, "backend", "production");
    const result = await authenticateApiKey(created.secret);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.key.userId).toBe(userId);
    expect(result.key.environment).toBe("production");
  });

  it("rejects a key that was never issued", async () => {
    const result = await authenticateApiKey(`sk_live_${"a".repeat(43)}`);
    expect(result).toEqual({ ok: false, reason: "unknown_key" });
  });

  it("rejects a malformed key without touching the database", async () => {
    expect(await authenticateApiKey("garbage")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  // Exit criterion: a revoked key cannot send.
  it("rejects a revoked key", async () => {
    const created = await createApiKey(userId, "backend", "production");
    expect((await authenticateApiKey(created.secret)).ok).toBe(true);

    await revokeApiKey(userId, created.summary.id);

    expect(await authenticateApiKey(created.secret)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("rejects an expired key", async () => {
    const created = await createApiKey(
      userId,
      "expiring",
      "production",
      new Date(Date.now() - 1000),
    );

    expect(await authenticateApiKey(created.secret)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("accepts a key whose expiry is still in the future", async () => {
    const created = await createApiKey(
      userId,
      "future",
      "production",
      new Date(Date.now() + 60_000),
    );

    expect((await authenticateApiKey(created.secret)).ok).toBe(true);
  });

  it("is not fooled by a key differing in one character", async () => {
    const created = await createApiKey(userId, "backend", "production");
    const tampered = `${created.secret.slice(0, -1)}${
      created.secret.endsWith("A") ? "B" : "A"
    }`;

    expect((await authenticateApiKey(tampered)).ok).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("lists only the caller's own keys", async () => {
    await createApiKey(userId, "mine", "production");
    await createApiKey(otherUserId, "theirs", "production");

    const mine = await listApiKeys(userId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.name).toBe("mine");
  });

  // A guessed key id from another tenant must match nothing.
  it("refuses to revoke another tenant's key", async () => {
    const victim = await createApiKey(otherUserId, "theirs", "production");

    const revoked = await revokeApiKey(userId, victim.summary.id);
    expect(revoked).toBe(false);

    // And the key still works for its real owner.
    expect((await authenticateApiKey(victim.secret)).ok).toBe(true);
  });

  it("reports revocation of an already-revoked key as a no-op", async () => {
    const created = await createApiKey(userId, "backend", "production");

    expect(await revokeApiKey(userId, created.summary.id)).toBe(true);
    expect(await revokeApiKey(userId, created.summary.id)).toBe(false);
  });
});

describe("touchApiKey", () => {
  it("records last use", async () => {
    const created = await createApiKey(userId, "backend", "production");
    expect(created.summary.lastUsedAt).toBeNull();

    await touchApiKey(created.summary.id);

    const [listed] = await listApiKeys(userId);
    expect(listed?.lastUsedAt).toBeInstanceOf(Date);
  });
});
