import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { awsConnections, awsCredentials } from "@/db/schema";
import type { CustomResourceRequest } from "@/lib/aws/connect";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

/**
 * One-click "Connect AWS" (Phase 10): the real repositories on PostgreSQL, AWS
 * mocked at `describeSesAccount` (which is where a role is actually assumed and
 * proven). Covers the whole lifecycle: start, CloudFormation's callback, the
 * dashboard's verification, and what each failure looks like.
 */
const describeSesAccount = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ses/client", () => ({
  describeSesAccount,
  createSesClient: vi.fn(),
  sendViaSes: vi.fn(),
}));

const ENV = {
  PLATFORM_AWS_ACCESS_KEY_ID: "AKIAPLATFORMEXAMPLE1",
  PLATFORM_AWS_SECRET_ACCESS_KEY: "platform-secret-key-example-0000000000",
  PLATFORM_AWS_PRINCIPAL_ARN: "arn:aws:iam::111122223333:user/ops-free-platform",
  AWS_CONNECT_TEMPLATE_URL: "https://ops-free-connect.s3.ap-south-1.amazonaws.com/connect/opsfree-connect.yaml",
  AWS_CONNECT_TOPIC_ARN: "arn:aws:sns:ap-south-1:111122223333:ops-free-connect",
};

const { startConnection, handleConnectCallback, checkConnection, ConnectError } = await import("@/server/aws-connect");
const { storeCredential, loadSesCredentials, loadDeliveryCredential, listCredentials } = await import("@/server/credentials");

const ROLE_ARN = "arn:aws:iam::123456789012:role/OpsFreeSES-abc123def456";
const ACCOUNT = {
  productionAccessEnabled: false,
  maxSendRate: 1,
  max24HourSend: 200,
  sentLast24Hours: 0,
  enforcementStatus: "HEALTHY",
};

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(process.env, ENV);
  describeSesAccount.mockResolvedValue(ACCOUNT);
  await resetTestDb();
  userId = await createTestUser("owner@example.test");
  otherUserId = await createTestUser("other@example.test");
});

afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await closeTestDb();
});

const callback = (externalId: string, over: Partial<CustomResourceRequest> = {}, roleArn = ROLE_ARN): CustomResourceRequest => ({
  RequestType: "Create",
  ResponseURL: "https://cloudformation-custom-resource-response-apsouth1.s3.ap-south-1.amazonaws.com/x?sig=1",
  StackId: "arn:aws:cloudformation:ap-south-1:123456789012:stack/OpsFreeSES-abc/uuid",
  RequestId: "req-1",
  LogicalResourceId: "TellOpsFree",
  ResourceProperties: { ExternalId: externalId, RoleArn: roleArn },
  ...over,
});

async function started(region = "ap-south-1", owner = userId) {
  const { connectionId, url } = await startConnection(owner, "production", region);
  const [row] = await getDb().select().from(awsConnections).where(eq(awsConnections.id, connectionId));
  return { connectionId, url, row: row! };
}

describe("starting", () => {
  it("mints a fresh ExternalId per click and bakes it into the link", async () => {
    const a = await started();
    const b = await started();
    expect(a.row.externalId).not.toBe(b.row.externalId);
    expect(new URLSearchParams(a.url.split("quickcreate?")[1]).get("param_ExternalId")).toBe(a.row.externalId);
    expect(a.row.status).toBe("pending");
    expect(a.row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
  });

  it("lets only the newest click complete", async () => {
    const first = await started();
    await started();
    const [old] = await getDb().select().from(awsConnections).where(eq(awsConnections.id, first.connectionId));
    expect(old!.status).toBe("expired");
    // The old stack's callback is now refused.
    expect(await handleConnectCallback(callback(first.row.externalId))).toMatchObject({ status: "FAILED" });
  });

  it("limits how many attempts one tenant can start in an hour", async () => {
    for (let i = 0; i < 6; i++) await started();
    await expect(startConnection(userId, "production", "ap-south-1")).rejects.toBeInstanceOf(ConnectError);
    // Another tenant is unaffected.
    await expect(startConnection(otherUserId, "production", "ap-south-1")).resolves.toBeTruthy();
  });

  it("is unavailable when the platform isn't configured", async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    await expect(startConnection(userId, "production", "ap-south-1")).rejects.toBeInstanceOf(ConnectError);
  });
});

describe("CloudFormation's callback", () => {
  it("records the role and succeeds", async () => {
    const { row } = await started();
    expect(await handleConnectCallback(callback(row.externalId))).toEqual({ status: "SUCCESS" });
    const [after] = await getDb().select().from(awsConnections).where(eq(awsConnections.id, row.id));
    expect(after!.roleArn).toBe(ROLE_ARN);
    expect(after!.callbackAt).not.toBeNull();
    // A hint only: nothing is trusted or stored as a credential yet.
    expect(await getDb().select().from(awsCredentials)).toHaveLength(0);
  });

  it("is idempotent when SNS redelivers", async () => {
    const { row } = await started();
    await handleConnectCallback(callback(row.externalId));
    expect(await handleConnectCallback(callback(row.externalId))).toEqual({ status: "SUCCESS" });
  });

  it("fails an unknown ExternalId, so a stray stack rolls back instead of hanging", async () => {
    const out = await handleConnectCallback(callback("opsfree-never-issued"));
    expect(out).toMatchObject({ status: "FAILED" });
  });

  it("fails an expired attempt", async () => {
    const { row } = await started();
    await getDb().update(awsConnections).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(awsConnections.id, row.id));
    expect(await handleConnectCallback(callback(row.externalId))).toMatchObject({ status: "FAILED" });
  });

  it.each([
    "arn:aws:iam::123456789012:role/AdministratorAccess",
    "arn:aws:iam::123456789012:user/OpsFreeSES-abc123def456",
    "garbage",
  ])("refuses a role ARN that isn't ours: %s", async (arn) => {
    const { row } = await started();
    expect(await handleConnectCallback(callback(row.externalId, {}, arn))).toMatchObject({ status: "FAILED" });
    const [after] = await getDb().select().from(awsConnections).where(eq(awsConnections.id, row.id));
    expect(after!.roleArn).toBeNull();
  });
});

describe("verifying and connecting", () => {
  it("waits for the callback", async () => {
    const { connectionId } = await started();
    expect(await checkConnection(userId, connectionId)).toEqual({ state: "waiting" });
    expect(describeSesAccount).not.toHaveBeenCalled();
  });

  it("proves the role by assuming it, then stores a role credential with no secret", async () => {
    const { connectionId, row } = await started("ap-southeast-1");
    await handleConnectCallback(callback(row.externalId));

    expect(await checkConnection(userId, connectionId)).toEqual({ state: "connected" });

    const asked = describeSesAccount.mock.calls[0]![0];
    expect(asked).toMatchObject({ roleArn: ROLE_ARN, externalId: row.externalId, region: "ap-southeast-1" });

    const [cred] = await getDb().select().from(awsCredentials).where(eq(awsCredentials.userId, userId));
    expect(cred).toMatchObject({
      kind: "role",
      roleArn: ROLE_ARN,
      externalId: row.externalId,
      awsRegion: "ap-southeast-1",
      accessKeyId: null,
      secretAccessKeyCiphertext: null,
      active: true,
      sesMaxSendRate: 1,
    });

    const [conn] = await getDb().select().from(awsConnections).where(eq(awsConnections.id, connectionId));
    expect(conn!.status).toBe("connected");
    // Polling again is harmless.
    expect(await checkConnection(userId, connectionId)).toEqual({ state: "connected" });
  });

  it("serves the role to the send path instead of a key", async () => {
    const { connectionId, row } = await started();
    await handleConnectCallback(callback(row.externalId));
    await checkConnection(userId, connectionId);

    const creds = await loadSesCredentials(userId, "production");
    expect(creds).toEqual({
      roleArn: ROLE_ARN,
      externalId: row.externalId,
      region: "ap-south-1",
      sessionName: `opsfree-${userId.slice(0, 8)}`,
    });
    const delivery = await loadDeliveryCredential(userId, "production");
    expect(delivery?.credentials).toEqual(creds);
    expect(delivery?.maxSendRate).toBe(1);
  });

  it("summarises a role credential without any key", async () => {
    const { connectionId, row } = await started();
    await handleConnectCallback(callback(row.externalId));
    await checkConnection(userId, connectionId);
    const [summary] = await listCredentials(userId);
    expect(summary).toMatchObject({ kind: "role", roleArn: ROLE_ARN, accessKeyId: null });
    expect(JSON.stringify(summary)).not.toMatch(/secret/i);
  });

  it("keeps retrying while a brand-new role isn't assumable yet (IAM propagation)", async () => {
    const { connectionId, row } = await started();
    await handleConnectCallback(callback(row.externalId));
    describeSesAccount.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "AccessDenied" }));

    expect(await checkConnection(userId, connectionId)).toEqual({ state: "verifying" });
    expect(await checkConnection(userId, connectionId)).toEqual({ state: "connected" });
  });

  it("fails clearly if AWS keeps refusing the role", async () => {
    const { connectionId, row } = await started();
    await handleConnectCallback(callback(row.externalId));
    await getDb()
      .update(awsConnections)
      .set({ callbackAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(awsConnections.id, connectionId));
    describeSesAccount.mockRejectedValue(Object.assign(new Error("denied"), { name: "AccessDenied" }));

    const state = await checkConnection(userId, connectionId);
    expect(state).toMatchObject({ state: "failed" });
    expect((state as { message: string }).message).toMatch(/delete the CloudFormation stack/i);
    expect(await getDb().select().from(awsCredentials)).toHaveLength(0);
    // And it stays failed rather than retrying forever.
    describeSesAccount.mockResolvedValue(ACCOUNT);
    expect(await checkConnection(userId, connectionId)).toMatchObject({ state: "failed" });
  });

  it("reports an expired attempt", async () => {
    const { connectionId } = await started();
    await getDb().update(awsConnections).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(awsConnections.id, connectionId));
    expect(await checkConnection(userId, connectionId)).toMatchObject({ state: "failed" });
  });

  it("never lets one tenant poll, or complete, another's attempt", async () => {
    const { connectionId, row } = await started();
    await handleConnectCallback(callback(row.externalId));
    expect(await checkConnection(otherUserId, connectionId)).toMatchObject({ state: "failed" });
    expect(await getDb().select().from(awsCredentials)).toHaveLength(0);
  });
});

describe("switching between a role and access keys", () => {
  const keys = {
    userId: "",
    environment: "production" as const,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    awsRegion: "ap-south-1",
  };

  it("replaces a role with keys, clearing the role columns", async () => {
    const { connectionId, row } = await started();
    await handleConnectCallback(callback(row.externalId));
    await checkConnection(userId, connectionId);

    await storeCredential({ ...keys, userId });
    const [cred] = await getDb().select().from(awsCredentials).where(eq(awsCredentials.userId, userId));
    expect(cred).toMatchObject({ kind: "access_key", roleArn: null, externalId: null, accessKeyId: keys.accessKeyId });
    expect(cred!.secretAccessKeyCiphertext).toBeTruthy();
    expect((await loadSesCredentials(userId, "production"))?.accessKeyId).toBe(keys.accessKeyId);
  });

  it("replaces keys with a role", async () => {
    await storeCredential({ ...keys, userId });
    const { connectionId, row } = await started();
    await handleConnectCallback(callback(row.externalId));
    await checkConnection(userId, connectionId);

    const [cred] = await getDb().select().from(awsCredentials).where(eq(awsCredentials.userId, userId));
    expect(cred).toMatchObject({ kind: "role", accessKeyId: null, secretAccessKeyCiphertext: null });
  });

  it("the database refuses a row that is neither shape", async () => {
    await expect(
      getDb().insert(awsCredentials).values({ userId, environment: "production", kind: "role", awsRegion: "ap-south-1" }),
    ).rejects.toThrow();
    await expect(
      getDb()
        .insert(awsCredentials)
        .values({ userId, environment: "production", kind: "access_key", accessKeyId: "AKIA", awsRegion: "ap-south-1" }),
    ).rejects.toThrow();
  });
});

describe("the customer deleting the stack", () => {
  it("deactivates the credential, so sends stop being attempted", async () => {
    const { connectionId, row } = await started();
    await handleConnectCallback(callback(row.externalId));
    await checkConnection(userId, connectionId);

    expect(await handleConnectCallback(callback(row.externalId, { RequestType: "Delete" }))).toEqual({ status: "SUCCESS" });
    const [cred] = await getDb().select().from(awsCredentials).where(eq(awsCredentials.userId, userId));
    expect(cred!.active).toBe(false);
    expect(await loadSesCredentials(userId, "production")).toBeNull();
  });

  it("leaves a newer connection alone when an old stack is deleted", async () => {
    const first = await started();
    await handleConnectCallback(callback(first.row.externalId));
    await checkConnection(userId, first.connectionId);

    const second = await started();
    await handleConnectCallback(callback(second.row.externalId, {}, "arn:aws:iam::123456789012:role/OpsFreeSES-fedcba654321"));
    await checkConnection(userId, second.connectionId);

    await handleConnectCallback(callback(first.row.externalId, { RequestType: "Delete" }));
    const [cred] = await getDb().select().from(awsCredentials).where(eq(awsCredentials.userId, userId));
    expect(cred!.active).toBe(true);
    expect(cred!.externalId).toBe(second.row.externalId);
  });

  it("answers Delete for something we never knew", async () => {
    expect(await handleConnectCallback(callback("opsfree-unknown", { RequestType: "Delete" }))).toEqual({ status: "SUCCESS" });
  });
});
