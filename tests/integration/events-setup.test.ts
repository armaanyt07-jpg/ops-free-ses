import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { snsTopics, verifiedDomains } from "@/db/schema";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

/**
 * "Connect events" — Phase 8.
 *
 * Real repositories on PostgreSQL; AWS mocked at the SDK boundary, so the
 * commands `src/lib/aws/events.ts` builds are what the assertions see. Each
 * AWS call is recorded as `Service:Command` in the order it was sent.
 */
const aws = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; input: Record<string, unknown> }>,
  /** Command name → error to throw when it is sent. */
  fail: new Map<string, Error>(),
}));

function fakeClient(service: string) {
  return {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const op = `${service}:${command.constructor.name.replace(/Command$/, "")}`;
      aws.calls.push({ op, input: command.input });
      const error = aws.fail.get(op);
      if (error) throw error;
      if (op === "SNS:CreateTopic") {
        return { TopicArn: `arn:aws:sns:us-east-1:123456789012:${String(command.input.Name)}` };
      }
      return {};
    },
    destroy: () => undefined,
  };
}

vi.mock("@aws-sdk/client-sns", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-sns")>()),
  SNSClient: vi.fn(function () {
    return fakeClient("SNS");
  }),
}));
vi.mock("@/lib/ses/client", () => ({
  createSesClient: () => fakeClient("SES"),
  describeSesAccount: vi.fn(async () => ({
    productionAccessEnabled: false,
    maxSendRate: 1,
    max24HourSend: 200,
    sentLast24Hours: 0,
    enforcementStatus: "HEALTHY",
  })),
  sendViaSes: vi.fn(),
}));

const { connectEvents, connectEventsAfterConnect, EventsSetupError, hasManagedEvents } = await import("@/server/events-setup");
const { storeCredential } = await import("@/server/credentials");
const { findTopicByArn } = await import("@/server/sns-topics");

const ENDPOINT = "https://app.example.com/api/v1/webhooks/aws-sns";
const TOPIC = "arn:aws:sns:us-east-1:123456789012:ops-free-ses-events";

function awsError(name: string) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 403 } });
}

let userId: string;

beforeEach(async () => {
  aws.calls.length = 0;
  aws.fail.clear();
  await resetTestDb();
  userId = await createTestUser();
  await storeCredential({
    userId,
    environment: "production",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    awsRegion: "us-east-1",
  });
  for (const [domain, status] of [["a.example.com", "verified"], ["b.example.com", "pending"]] as const) {
    await getDb().insert(verifiedDomains).values({ userId, domain, environment: "production", status, awsRegion: "us-east-1" });
  }
});

afterAll(async () => {
  await closeTestDb();
});

describe("connectEvents", () => {
  it("creates the topic, subscribes the webhook, and wires SES to it", async () => {
    const result = await connectEvents(userId, "production", ENDPOINT);

    expect(aws.calls.map((c) => c.op)).toEqual([
      "SNS:CreateTopic",
      "SNS:Subscribe",
      "SES:CreateConfigurationSet",
      "SES:CreateConfigurationSetEventDestination",
      "SES:PutEmailIdentityConfigurationSetAttributes",
      "SES:PutEmailIdentityConfigurationSetAttributes",
    ]);
    expect(aws.calls[1]!.input).toEqual({ TopicArn: TOPIC, Protocol: "https", Endpoint: ENDPOINT });
    expect(aws.calls[3]!.input).toMatchObject({
      ConfigurationSetName: "ops-free",
      EventDestination: {
        Enabled: true,
        MatchingEventTypes: ["BOUNCE", "COMPLAINT", "DELIVERY"],
        SnsDestination: { TopicArn: TOPIC },
      },
    });
    expect(result).toEqual({ topicArn: TOPIC, domains: ["a.example.com", "b.example.com"] });
  });

  it("registers the topic as managed before subscribing, so the webhook confirms it", async () => {
    // Fail the subscribe: registration must already have happened.
    aws.fail.set("SNS:Subscribe", awsError("InternalError"));
    await expect(connectEvents(userId, "production", ENDPOINT)).rejects.toBeInstanceOf(EventsSetupError);

    const topic = await findTopicByArn(TOPIC);
    expect(topic).toMatchObject({ userId, managed: true, environment: "production", status: "pending" });
    expect(await hasManagedEvents(userId, "production")).toBe(true);
    expect(await hasManagedEvents(userId, "staging")).toBe(false);
  });

  it("is idempotent: running it again updates the destination instead of failing", async () => {
    await connectEvents(userId, "production", ENDPOINT);
    aws.calls.length = 0;
    aws.fail.set("SES:CreateConfigurationSet", awsError("AlreadyExistsException"));
    aws.fail.set("SES:CreateConfigurationSetEventDestination", awsError("AlreadyExistsException"));

    await connectEvents(userId, "production", ENDPOINT);

    expect(aws.calls.map((c) => c.op)).toContain("SES:UpdateConfigurationSetEventDestination");
    expect(await getDb().select().from(snsTopics).where(eq(snsTopics.userId, userId))).toHaveLength(1);
  });

  it("names the missing IAM permission when AWS says no", async () => {
    aws.fail.set("SNS:CreateTopic", awsError("AuthorizationError"));
    await expect(connectEvents(userId, "production", ENDPOINT)).rejects.toThrow(
      /not allowed to call sns:CreateTopic/,
    );
    expect(await findTopicByArn(TOPIC)).toBeNull();
  });

  it("skips an identity that was deleted in the SES console", async () => {
    aws.fail.set("SES:PutEmailIdentityConfigurationSetAttributes", awsError("NotFoundException"));
    const result = await connectEvents(userId, "production", ENDPOINT);
    expect(result.domains).toEqual([]);
  });

  it("refuses a local or plain-HTTP endpoint before calling AWS", async () => {
    await expect(
      connectEvents(userId, "production", "http://localhost:3000/api/v1/webhooks/aws-sns"),
    ).rejects.toThrow(/public HTTPS address/);
    expect(aws.calls).toHaveLength(0);
  });

  it("needs a credential for the environment", async () => {
    await expect(connectEvents(userId, "staging", ENDPOINT)).rejects.toThrow(
      /Connect your AWS account for staging first/,
    );
    expect(aws.calls).toHaveLength(0);
  });

  it("will not take over a topic another tenant registered", async () => {
    const other = await createTestUser();
    await getDb().insert(snsTopics).values({ userId: other, topicArn: TOPIC });
    await expect(connectEvents(userId, "production", ENDPOINT)).rejects.toThrow(
      /already registered to another account/,
    );
    expect(aws.calls.map((c) => c.op)).toEqual(["SNS:CreateTopic"]);
  });
});

describe("connectEventsAfterConnect", () => {
  const PUBLIC = { url: ENDPOINT, local: false };

  it("sets up events as part of connecting AWS", async () => {
    expect(await connectEventsAfterConnect(userId, "production", PUBLIC)).toBe(true);
    expect(await hasManagedEvents(userId, "production")).toBe(true);
    expect(aws.calls.map((c) => c.op)).toContain("SES:CreateConfigurationSet");
  });

  it("does nothing once events are connected", async () => {
    await connectEventsAfterConnect(userId, "production", PUBLIC);
    aws.calls.length = 0;
    expect(await connectEventsAfterConnect(userId, "production", PUBLIC)).toBe(true);
    expect(aws.calls).toHaveLength(0);
  });

  it("never fails the connection; the Connect events button stays as the fallback", async () => {
    aws.fail.set("SNS:CreateTopic", awsError("AccessDenied"));
    expect(await connectEventsAfterConnect(userId, "production", PUBLIC)).toBe(false);
    expect(await hasManagedEvents(userId, "production")).toBe(false);
  });

  it("skips when SNS couldn't reach this app", async () => {
    expect(await connectEventsAfterConnect(userId, "production", { url: "http://localhost:3000/x", local: true })).toBe(false);
    expect(aws.calls).toHaveLength(0);
  });
});
