import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { awsCredentials } from "@/db/schema";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

/**
 * The SES client is mocked: these tests exercise the vault, not AWS. The
 * contract mocked here (`describeSesAccount` throws on bad credentials) is the
 * one `storeCredential` depends on.
 */
const describeSesAccount = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ses/client", () => ({
  describeSesAccount,
  createSesClient: vi.fn(),
  sendViaSes: vi.fn(),
}));

const {
  CredentialValidationError,
  deleteCredential,
  listCredentials,
  loadSesCredentials,
  setCredentialActive,
  storeCredential,
} = await import("@/server/credentials");

const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const HEALTHY_ACCOUNT = {
  productionAccessEnabled: true,
  maxSendRate: 14,
  max24HourSend: 50_000,
  sentLast24Hours: 120,
  enforcementStatus: "HEALTHY",
};

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  describeSesAccount.mockResolvedValue(HEALTHY_ACCOUNT);

  await resetTestDb();
  userId = await createTestUser("owner@example.test");
  otherUserId = await createTestUser("other@example.test");
});

afterAll(async () => {
  await closeTestDb();
});

function input(overrides: Partial<Parameters<typeof storeCredential>[0]> = {}) {
  return {
    userId,
    environment: "production" as const,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: SECRET,
    awsRegion: "us-east-1",
    ...overrides,
  };
}

describe("storeCredential", () => {
  it("validates against AWS before persisting", async () => {
    await storeCredential(input());
    expect(describeSesAccount).toHaveBeenCalledOnce();
  });

  // An unusable key must never reach the database.
  it("stores nothing when AWS rejects the credential", async () => {
    describeSesAccount.mockRejectedValue(
      Object.assign(new Error("nope"), { name: "InvalidClientTokenId" }),
    );

    await expect(storeCredential(input())).rejects.toBeInstanceOf(
      CredentialValidationError,
    );

    expect(await listCredentials(userId)).toHaveLength(0);
  });

  it.each([
    ["AccessDeniedException", /accepted these keys.*ses:GetAccount/],
    ["SignatureDoesNotMatch", /secret access key does not match/],
    ["InvalidClientTokenId", /does not recognise this access key ID/],
    ["UnknownError", /\(UnknownError\)/],
  ])("explains a %s rejection specifically", async (name, message) => {
    describeSesAccount.mockRejectedValue(
      Object.assign(new Error("nope"), { name }),
    );
    await expect(storeCredential(input())).rejects.toThrow(message);
  });

    it("encrypts the secret at rest", async () => {
    await storeCredential(input());

    const [row] = await getDb()
      .select()
      .from(awsCredentials)
      .where(eq(awsCredentials.userId, userId));

    expect(row?.secretAccessKeyCiphertext).toBeDefined();
    expect(row?.secretAccessKeyCiphertext).not.toContain(SECRET);
    expect(
      Buffer.from(row!.secretAccessKeyCiphertext!, "base64").toString("utf8"),
    ).not.toContain(SECRET);
  });

  // Exit criterion: the secret is never returned after creation.
  it("returns a summary with no secret-bearing field", async () => {
    const { credential } = await storeCredential(input());

    expect(JSON.stringify(credential)).not.toContain(SECRET);
    expect(credential).not.toHaveProperty("secretAccessKey");
    expect(credential).not.toHaveProperty("secretAccessKeyCiphertext");
    // The access key ID is not a secret and is shown for identification.
    expect(credential.accessKeyId).toBe("AKIAIOSFODNN7EXAMPLE");
  });

  it("records the SES send rate reported by AWS", async () => {
    const { credential } = await storeCredential(input());
    expect(credential.sesMaxSendRate).toBe(14);
  });

  it("floors a fractional send rate into the integer column", async () => {
    describeSesAccount.mockResolvedValue({
      ...HEALTHY_ACCOUNT,
      maxSendRate: 1.5,
    });

    const { credential } = await storeCredential(input());
    expect(credential.sesMaxSendRate).toBe(1);
  });

  it("surfaces sandbox state to the caller", async () => {
    describeSesAccount.mockResolvedValue({
      ...HEALTHY_ACCOUNT,
      productionAccessEnabled: false,
    });

    const { account } = await storeCredential(input());
    expect(account.productionAccessEnabled).toBe(false);
  });

  it("keeps staging and production credentials separate", async () => {
    await storeCredential(input({ environment: "production" }));
    await storeCredential(
      input({ environment: "staging", accessKeyId: "AKIASTAGINGEXAMPLE00" }),
    );

    const all = await listCredentials(userId);
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.environment).sort()).toEqual([
      "production",
      "staging",
    ]);
  });

  // Re-submitting the same environment is how rotation works.
  it("replaces the stored secret on rotation rather than duplicating", async () => {
    await storeCredential(input());
    await storeCredential(
      input({
        accessKeyId: "AKIAROTATEDEXAMPLE00",
        secretAccessKey: "rotated-secret-value-1234567890",
      }),
    );

    const all = await listCredentials(userId);
    expect(all).toHaveLength(1);
    expect(all[0]?.accessKeyId).toBe("AKIAROTATEDEXAMPLE00");

    const loaded = await loadSesCredentials(userId, "production");
    expect(loaded?.secretAccessKey).toBe("rotated-secret-value-1234567890");
  });
});

describe("loadSesCredentials", () => {
  it("decrypts the stored secret for the owning tenant", async () => {
    await storeCredential(input());

    const loaded = await loadSesCredentials(userId, "production");
    expect(loaded).toEqual({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: SECRET,
      region: "us-east-1",
    });
  });

  it("returns null when the environment has no credential", async () => {
    await storeCredential(input({ environment: "production" }));
    expect(await loadSesCredentials(userId, "staging")).toBeNull();
  });

  it("returns null once the credential is deactivated", async () => {
    const { credential } = await storeCredential(input());
    await setCredentialActive(userId, credential.id, false);

    expect(await loadSesCredentials(userId, "production")).toBeNull();
  });

  /**
   * The AAD binds each ciphertext to its tenant and environment. Copying a row
   * to another tenant must fail closed rather than decrypt.
   */
  it("cannot decrypt a ciphertext transplanted to another tenant", async () => {
    await storeCredential(input());

    const [row] = await getDb()
      .select()
      .from(awsCredentials)
      .where(eq(awsCredentials.userId, userId));

    await getDb().insert(awsCredentials).values({
      userId: otherUserId,
      environment: "production",
      accessKeyId: row!.accessKeyId,
      secretAccessKeyCiphertext: row!.secretAccessKeyCiphertext,
      awsRegion: row!.awsRegion,
      active: true,
    });

    await expect(
      loadSesCredentials(otherUserId, "production"),
    ).rejects.toThrow(/authentication failed/i);
  });
});

describe("tenant isolation", () => {
  it("lists only the caller's credentials", async () => {
    await storeCredential(input());
    await storeCredential(input({ userId: otherUserId }));

    expect(await listCredentials(userId)).toHaveLength(1);
  });

  it("refuses to deactivate another tenant's credential", async () => {
    const { credential } = await storeCredential(input({ userId: otherUserId }));

    expect(await setCredentialActive(userId, credential.id, false)).toBe(false);
    expect(await loadSesCredentials(otherUserId, "production")).not.toBeNull();
  });

  it("refuses to delete another tenant's credential", async () => {
    const { credential } = await storeCredential(input({ userId: otherUserId }));

    expect(await deleteCredential(userId, credential.id)).toBe(false);
    expect(await listCredentials(otherUserId)).toHaveLength(1);
  });
});
