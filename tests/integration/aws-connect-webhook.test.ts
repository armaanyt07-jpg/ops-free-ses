import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { awsConnections } from "@/db/schema";

import { createTestUser } from "../support/factories";
import { createSnsSigner, subscriptionConfirmation, type SnsSigner } from "../support/sns";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

/**
 * POST /api/v1/webhooks/aws-connect — Phase 10.
 *
 * The real route with real signature verification. Substituted: the
 * certificate fetch, the SubscribeURL visit, and the PUT back to
 * CloudFormation's presigned URL (captured so the test can read the answer a
 * customer's stack would receive).
 */
const fetchSigningCertificate = vi.hoisted(() => vi.fn());
const confirmSubscription = vi.hoisted(() => vi.fn());
const putResponse = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sns/certificate", () => ({ fetchSigningCertificate }));
vi.mock("@/lib/sns/subscription", () => ({ confirmSubscription }));
vi.mock("@/lib/aws/connect", async (original) => ({
  ...(await original<typeof import("@/lib/aws/connect")>()),
  putResponse,
}));

const ENV = {
  PLATFORM_AWS_ACCESS_KEY_ID: "AKIAPLATFORMEXAMPLE1",
  PLATFORM_AWS_SECRET_ACCESS_KEY: "platform-secret-key-example-0000000000",
  PLATFORM_AWS_PRINCIPAL_ARN: "arn:aws:iam::111122223333:user/ops-free-platform",
  AWS_CONNECT_TEMPLATE_URL: "https://ops-free-connect.s3.ap-south-1.amazonaws.com/connect/opsfree-connect.yaml",
  AWS_CONNECT_TOPIC_ARN: "arn:aws:sns:ap-south-1:111122223333:ops-free-connect",
};
const TOPIC = ENV.AWS_CONNECT_TOPIC_ARN;
const RESPONSE_URL =
  "https://cloudformation-custom-resource-response-apsouth1.s3.ap-south-1.amazonaws.com/x?X-Amz-Signature=abc";
const ROLE_ARN = "arn:aws:iam::123456789012:role/OpsFreeSES-abc123def456";

const { NextRequest } = await import("next/server");
const { POST } = await import("@/app/api/v1/webhooks/aws-connect/route");
const { startConnection } = await import("@/server/aws-connect");

let signer: SnsSigner;
let userId: string;
let externalId: string;

beforeAll(() => {
  signer = createSnsSigner();
});

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(process.env, ENV);
  fetchSigningCertificate.mockResolvedValue(signer.certificate);
  confirmSubscription.mockResolvedValue({ subscriptionArn: `${TOPIC}:sub-1` });
  putResponse.mockResolvedValue(undefined);

  await resetTestDb();
  userId = await createTestUser();
  const { connectionId } = await startConnection(userId, "production", "ap-south-1");
  const [row] = await getDb().select().from(awsConnections).where(eq(awsConnections.id, connectionId));
  externalId = row!.externalId;
});

afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await closeTestDb();
});

function cfnMessage(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  return {
    RequestType: "Create",
    ResponseURL: RESPONSE_URL,
    StackId: "arn:aws:cloudformation:ap-south-1:123456789012:stack/OpsFreeSES-abc/uuid",
    RequestId: "req-1",
    LogicalResourceId: "TellOpsFree",
    ResourceType: "Custom::OpsFreeConnect",
    ResourceProperties: { ServiceToken: TOPIC, ExternalId: externalId, RoleArn: ROLE_ARN, ...props },
    ...over,
  };
}

function notification(message: unknown, { topicArn = TOPIC }: { topicArn?: string } = {}) {
  return signer.sign({
    Type: "Notification" as const,
    MessageId: randomUUID(),
    TopicArn: topicArn,
    Message: typeof message === "string" ? message : JSON.stringify(message),
    Timestamp: new Date().toISOString(),
    SignatureVersion: "1" as const,
    SigningCertURL: signer.certUrl,
    UnsubscribeURL: `https://sns.ap-south-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=${topicArn}:sub`,
  });
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/v1/webhooks/aws-connect", {
      method: "POST",
      headers: { "content-type": "text/plain; charset=UTF-8" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const answer = () => JSON.parse(putResponse.mock.calls[0]![1] as string);

describe("a valid stack callback", () => {
  it("records the role and tells CloudFormation it succeeded", async () => {
    const res = await post(notification(cfnMessage()));
    expect(res.status).toBe(200);

    expect(putResponse).toHaveBeenCalledTimes(1);
    expect(putResponse.mock.calls[0]![0]).toBe(RESPONSE_URL);
    expect(answer()).toMatchObject({ Status: "SUCCESS", RequestId: "req-1", LogicalResourceId: "TellOpsFree" });

    const [row] = await getDb().select().from(awsConnections).where(eq(awsConnections.externalId, externalId));
    expect(row!.roleArn).toBe(ROLE_ARN);
  });

  it("answers a Delete (stack removed) with success", async () => {
    await post(notification(cfnMessage({ RequestType: "Delete", PhysicalResourceId: "opsfree-x" })));
    expect(answer()).toMatchObject({ Status: "SUCCESS" });
  });

  it("answers FAILED for a request it doesn't recognise, so the stack rolls back", async () => {
    const res = await post(notification(cfnMessage({}, { ExternalId: "opsfree-never-issued" })));
    expect(res.status).toBe(200);
    expect(answer()).toMatchObject({ Status: "FAILED" });
    expect(answer().Reason).toMatch(/unknown or has expired/);
  });

  it("tells SNS to retry if the answer can't be delivered", async () => {
    putResponse.mockRejectedValueOnce(new Error("S3 down"));
    const res = await post(notification(cfnMessage()));
    expect(res.status).toBe(500);
  });
});

describe("what it refuses", () => {
  it("a forged signature", async () => {
    const msg = notification(cfnMessage());
    const res = await post({ ...msg, Message: JSON.stringify(cfnMessage({}, { RoleArn: ROLE_ARN.replace("abc", "zzz") })) });
    expect(res.status).toBe(401);
    expect(putResponse).not.toHaveBeenCalled();
  });

  it("a validly signed message from any topic but ours", async () => {
    const res = await post(notification(cfnMessage(), { topicArn: "arn:aws:sns:ap-south-1:999999999999:attacker" }));
    expect(res.status).toBe(403);
    expect(putResponse).not.toHaveBeenCalled();
  });

  it("a response URL that isn't an AWS response bucket, never PUT to", async () => {
    for (const url of ["https://evil.example.com/x", "http://169.254.169.254/latest", "https://localhost/x"]) {
      const res = await post(notification(cfnMessage({ ResponseURL: url })));
      expect(res.status).toBe(400);
    }
    expect(putResponse).not.toHaveBeenCalled();
  });

  it("a message that isn't a CloudFormation request", async () => {
    expect((await post(notification("just text"))).status).toBe(400);
    expect((await post(notification({ hello: "world" }))).status).toBe(400);
  });

  it("a body that isn't an SNS envelope", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ Type: "Notification" })).status).toBe(400);
  });

  it("everything, with 404, when one-click connect isn't configured", async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    expect((await post(notification(cfnMessage()))).status).toBe(404);
  });
});

describe("subscribing the topic", () => {
  it("confirms the subscription for our topic", async () => {
    const res = await post(subscriptionConfirmation(signer, { topicArn: TOPIC }));
    expect(res.status).toBe(200);
    expect(confirmSubscription).toHaveBeenCalledTimes(1);
  });

  it("never confirms a subscription for someone else's topic", async () => {
    const res = await post(subscriptionConfirmation(signer, { topicArn: "arn:aws:sns:ap-south-1:999999999999:attacker" }));
    expect(res.status).toBe(403);
    expect(confirmSubscription).not.toHaveBeenCalled();
  });
});
