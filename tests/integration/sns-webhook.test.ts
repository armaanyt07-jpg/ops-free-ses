import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailLogs, snsEvents, snsTopics, suppressionList } from "@/db/schema";

import { createTestUser } from "../support/factories";
import {
  createSnsSigner,
  sesEvents,
  sesNotification,
  subscriptionConfirmation,
  TEST_TOPIC_ARN,
  type SnsSigner,
} from "../support/sns";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

/**
 * POST /api/v1/webhooks/aws-sns — SRS FR-5, §7, §16 ("Webhooks: signature
 * validation and idempotency work").
 *
 * Real route, real signature verification with a real certificate, real
 * transaction against real PostgreSQL. The only substitutes are the two
 * outbound HTTPS calls: fetching the signing certificate, and visiting the
 * SubscribeURL.
 */
const fetchSigningCertificate = vi.hoisted(() => vi.fn());
const confirmSubscription = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sns/certificate", () => ({ fetchSigningCertificate }));
vi.mock("@/lib/sns/subscription", () => ({ confirmSubscription }));

const { NextRequest } = await import("next/server");
const { POST } = await import("@/app/api/v1/webhooks/aws-sns/route");
const { registerTopic, TopicRegistrationError } = await import("@/server/sns-topics");
const { createQueuedLog, markSending, markSent } = await import("@/server/email-logs");
const { reconcileEventsForLog, webhookStats } = await import("@/server/sns-events");

let signer: SnsSigner;
let userId: string;

beforeAll(() => {
  signer = createSnsSigner();
});

beforeEach(async () => {
  vi.clearAllMocks();
  fetchSigningCertificate.mockResolvedValue(signer.certificate);
  confirmSubscription.mockResolvedValue({
    subscriptionArn: `${TEST_TOPIC_ARN}:sub-1`,
  });

  await resetTestDb();
  userId = await createTestUser();
  await registerTopic(userId, TEST_TOPIC_ARN);
});

afterAll(async () => {
  await closeTestDb();
});

/** SNS posts JSON with a text/plain content type. */
function post(body: unknown) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return POST(
    new NextRequest("http://localhost/api/v1/webhooks/aws-sns", {
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=UTF-8",
        "x-amz-sns-message-type": "Notification",
      },
      body: raw,
    }),
  );
}

/** A log that SES has accepted, as the worker would leave it. */
async function sentLog(
  recipients: string[],
  owner = userId,
): Promise<{ logId: string; sesMessageId: string }> {
  const created = await createQueuedLog({
    userId: owner,
    environment: "production",
    fromAddress: "sender@example.com",
    recipients,
    subject: "Hello",
    idempotencyKey: null,
    tags: null,
  });
  if (created.outcome !== "created") throw new Error("unexpected duplicate");
  const sesMessageId = `0100-${randomUUID()}`;
  await markSent(created.logId, { messageId: sesMessageId, sesRequestId: "req" });
  return { logId: created.logId, sesMessageId };
}

async function logRow(logId: string) {
  const [row] = await getDb().select().from(emailLogs).where(eq(emailLogs.id, logId));
  return row!;
}

async function suppressionsFor(owner = userId) {
  return getDb()
    .select()
    .from(suppressionList)
    .where(eq(suppressionList.userId, owner));
}

async function eventCount() {
  return (await getDb().select().from(snsEvents)).length;
}

describe("authentication", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
  });

  it("rejects a raw SES event (raw message delivery left on)", async () => {
    const res = await post(sesEvents.bounce("m", ["a@x.com"]));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/Raw message delivery/);
  });

  it("rejects a forged bounce and writes nothing", async () => {
    const { logId, sesMessageId } = await sentLog(["victim@example.com"]);
    const forged = {
      ...sesNotification(signer, sesEvents.bounce(sesMessageId, ["victim@example.com"])),
      Signature: signer.sign(sesNotification(signer, sesEvents.delivery("x", []))).Signature,
    };

    const res = await post(forged);

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(await eventCount()).toBe(0);
    expect(await suppressionsFor()).toHaveLength(0);
    expect((await logRow(logId)).status).toBe("sent");
  });

  it("rejects a message signed with someone else's key", async () => {
    const attacker = createSnsSigner();
    const msg = attacker.sign({
      ...sesNotification(signer, sesEvents.bounce("m", ["a@x.com"])),
      SigningCertURL: signer.certUrl,
    });
    expect((await post(msg)).status).toBe(401);
    expect(await suppressionsFor()).toHaveLength(0);
  });

  it("refuses a validly signed message from an unregistered topic", async () => {
    const other = "arn:aws:sns:us-east-1:999999999999:someone-elses";
    const res = await post(
      sesNotification(signer, sesEvents.bounce("m", ["a@x.com"]), { topicArn: other }),
    );
    expect(res.status).toBe(403);
    expect(await eventCount()).toBe(0);
    expect(await suppressionsFor()).toHaveLength(0);
  });

  it("never confirms a subscription for an unregistered topic", async () => {
    const other = "arn:aws:sns:us-east-1:999999999999:someone-elses";
    const res = await post(subscriptionConfirmation(signer, { topicArn: other }));
    expect(res.status).toBe(403);
    expect(confirmSubscription).not.toHaveBeenCalled();
  });

  it("answers 503, not 401, when the signing certificate cannot be fetched", async () => {
    fetchSigningCertificate.mockRejectedValueOnce(new Error("network"));
    const { logId, sesMessageId } = await sentLog(["a@x.com"]);
    const msg = sesNotification(signer, sesEvents.bounce(sesMessageId, ["a@x.com"]));

    const res = await post(msg);
    expect(res.status).toBe(503);
    expect(await eventCount()).toBe(0);

    // SNS retries; the certificate is reachable again; the event lands once.
    expect((await post(msg)).status).toBe(200);
    expect((await logRow(logId)).status).toBe("bounced");
  });

    it("refuses an oversized body before parsing it", async () => {
    const res = await post("x".repeat(600 * 1024));
    expect(res.status).toBe(413);
  });
});

describe("subscription lifecycle", () => {
  it("confirms a registered topic's subscription and records its ARN", async () => {
    const msg = subscriptionConfirmation(signer);
    const res = await post(msg);

    expect(res.status).toBe(200);
    expect(confirmSubscription).toHaveBeenCalledWith(msg.SubscribeURL);

    const [topic] = await getDb().select().from(snsTopics);
    expect(topic).toMatchObject({
      status: "confirmed",
      subscriptionArn: `${TEST_TOPIC_ARN}:sub-1`,
    });
    expect(topic?.confirmedAt).toBeInstanceOf(Date);
  });

  it("answers 5xx and records nothing when confirmation fails, so SNS retries", async () => {
    confirmSubscription.mockRejectedValueOnce(new Error("SNS unreachable"));
    const msg = subscriptionConfirmation(signer);

    expect((await post(msg)).status).toBe(500);
    expect(await eventCount()).toBe(0);

    // SNS redelivers the same message; this time it works.
    expect((await post(msg)).status).toBe(200);
    const [topic] = await getDb().select().from(snsTopics);
    expect(topic?.status).toBe("confirmed");
  });

  it("records an unsubscribe without re-subscribing", async () => {
    const res = await post(
      subscriptionConfirmation(signer, { type: "UnsubscribeConfirmation" }),
    );
    expect(res.status).toBe(200);
    expect(confirmSubscription).not.toHaveBeenCalled();
    const [topic] = await getDb().select().from(snsTopics);
    expect(topic?.status).toBe("unsubscribed");
  });
});

describe("event processing", () => {
  it("delivery: marks the log delivered and completes it", async () => {
    const { logId, sesMessageId } = await sentLog(["a@example.com"]);

    const res = await post(
      sesNotification(signer, sesEvents.delivery(sesMessageId, ["a@example.com"])),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "processed",
      eventType: "Delivery",
      matched: true,
      suppressed: 0,
    });

    const row = await logRow(logId);
    expect(row.status).toBe("delivered");
    expect(row.completedAt).toBeInstanceOf(Date);

    const [event] = await getDb().select().from(snsEvents);
    expect(event?.logId).toBe(logId);
    expect(event?.eventAt).toBeInstanceOf(Date);
  });

  it("hard bounce: marks the log bounced and suppresses the address", async () => {
    const { logId, sesMessageId } = await sentLog(["Gone@Example.com"]);
    const msg = sesNotification(
      signer,
      sesEvents.bounce(sesMessageId, ["Gone@Example.com"], "Permanent"),
    );

    const res = await post(msg);
    expect(await res.json()).toMatchObject({ suppressed: 1 });

    expect((await logRow(logId)).status).toBe("bounced");
    const [s] = await suppressionsFor();
    expect(s).toMatchObject({
      email: "gone@example.com",
      reason: "hard_bounce",
      sourceEventId: msg.MessageId,
      active: true,
    });
  });

  it("complaint: marks the log complained and suppresses the address", async () => {
    const { logId, sesMessageId } = await sentLog(["angry@example.com"]);
    await post(sesNotification(signer, sesEvents.complaint(sesMessageId, ["angry@example.com"])));

    expect((await logRow(logId)).status).toBe("complained");
    const [s] = await suppressionsFor();
    expect(s).toMatchObject({ email: "angry@example.com", reason: "complaint" });
  });

  it("transient bounce: updates the log but does not suppress", async () => {
    const { logId, sesMessageId } = await sentLog(["full@example.com"]);
    await post(
      sesNotification(signer, sesEvents.bounce(sesMessageId, ["full@example.com"], "Transient")),
    );

    expect((await logRow(logId)).status).toBe("bounced");
    expect(await suppressionsFor()).toHaveLength(0);
  });

  it("multi-recipient: tracks each recipient and shows the worst outcome", async () => {
    const { logId, sesMessageId } = await sentLog(["a@x.com", "b@x.com", "c@x.com"]);

    await post(sesNotification(signer, sesEvents.delivery(sesMessageId, ["a@x.com", "c@x.com"])));
    let row = await logRow(logId);
    expect(row.status).toBe("delivered");
    expect(row.completedAt).toBeNull();

    await post(sesNotification(signer, sesEvents.bounce(sesMessageId, ["b@x.com"])));
    row = await logRow(logId);
    expect(row.status).toBe("bounced");
    expect(row.completedAt).toBeInstanceOf(Date);

    const recipients = (row.providerEvent as { recipients: Record<string, { status: string }> })
      .recipients;
    expect(Object.fromEntries(Object.entries(recipients).map(([k, v]) => [k, v.status]))).toEqual({
      "a@x.com": "delivered",
      "b@x.com": "bounced",
      "c@x.com": "delivered",
    });
  });

  it("stores a redacted event: no subject, headers or sender", async () => {
    const { sesMessageId } = await sentLog(["a@x.com"]);
    await post(sesNotification(signer, sesEvents.bounce(sesMessageId, ["a@x.com"])));

    const [event] = await getDb().select().from(snsEvents);
    const stored = JSON.stringify(event?.payload);
    expect(stored).not.toContain("Secret subject line");
    expect(stored).not.toContain("sender@example.com");
  });

  it("an event for mail this platform did not send still suppresses", async () => {
    const res = await post(
      sesNotification(signer, sesEvents.bounce("0100-not-ours", ["elsewhere@example.com"])),
    );
    expect(await res.json()).toMatchObject({ matched: false, suppressed: 1 });
    expect(await suppressionsFor()).toHaveLength(1);
  });

  it("acknowledges non-SES messages without acting on them", async () => {
    const res = await post(sesNotification(signer, { hello: "world" } as never));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "processed", eventType: null });
  });
});

describe("idempotency", () => {
  it("a redelivered message is acknowledged and changes nothing", async () => {
    const { logId, sesMessageId } = await sentLog(["a@x.com"]);
    const msg = sesNotification(signer, sesEvents.bounce(sesMessageId, ["a@x.com"]));

    const first = await post(msg);
    const before = await logRow(logId);

    const second = await post(msg);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "duplicate" });
    expect(await eventCount()).toBe(1);
    expect(await suppressionsFor()).toHaveLength(1);
    expect(await logRow(logId)).toEqual(before);
  });

  it("concurrent duplicates: exactly one is processed", async () => {
    const { sesMessageId } = await sentLog(["a@x.com"]);
    const msg = sesNotification(signer, sesEvents.complaint(sesMessageId, ["a@x.com"]));

    const results = await Promise.all([post(msg), post(msg), post(msg)]);
    const bodies = await Promise.all(results.map((r) => r.json()));

    expect(bodies.filter((b) => b.status === "processed")).toHaveLength(1);
    expect(bodies.filter((b) => b.status === "duplicate")).toHaveLength(2);
    expect(await eventCount()).toBe(1);
  });

  it("a failure mid-processing rolls back entirely; the redelivery then applies", async () => {
    const { logId, sesMessageId } = await sentLog(["a@x.com"]);
    const msg = sesNotification(signer, sesEvents.bounce(sesMessageId, ["a@x.com"]));

    // Break the last write in the transaction (the suppression upsert).
    await getDb().execute("ALTER TABLE suppression_list RENAME TO suppression_list_away");
    let res;
    try {
      res = await post(msg);
    } finally {
      await getDb().execute("ALTER TABLE suppression_list_away RENAME TO suppression_list");
    }

    expect(res.status).toBe(500);
    // Nothing half-applied: no event row, so the MessageId is not "used up".
    expect(await eventCount()).toBe(0);
    expect((await logRow(logId)).status).toBe("sent");

    const retry = await post(msg);
    expect(await retry.json()).toMatchObject({ status: "processed", suppressed: 1 });
    expect((await logRow(logId)).status).toBe("bounced");
  });
});

describe("suppression upsert", () => {
  it("keeps the first reason for an already-active address", async () => {
    await post(sesNotification(signer, sesEvents.complaint("m1", ["a@x.com"])));
    await post(sesNotification(signer, sesEvents.bounce("m2", ["a@x.com"])));

    const rows = await suppressionsFor();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("complaint");
  });

  it("re-activates a deactivated address on fresh evidence", async () => {
    await post(sesNotification(signer, sesEvents.complaint("m1", ["a@x.com"])));
    await getDb().update(suppressionList).set({ active: false });

    const msg = sesNotification(signer, sesEvents.bounce("m2", ["a@x.com"]));
    await post(msg);

    const [row] = await suppressionsFor();
    expect(row).toMatchObject({ active: true, reason: "hard_bounce", sourceEventId: msg.MessageId });
  });
});

describe("tenant isolation", () => {
  it("an event on tenant A's topic never touches tenant B", async () => {
    const tenantB = await createTestUser();
    // Same SES message id in both tenants: contrived, but the point is that
    // attribution comes from the topic, not from anything in the payload.
    const { logId: logB, sesMessageId } = await sentLog(["x@example.com"], tenantB);

    const res = await post(
      sesNotification(signer, sesEvents.bounce(sesMessageId, ["x@example.com"])),
    );

    expect(await res.json()).toMatchObject({ matched: false });
    expect((await logRow(logB)).status).toBe("sent");
    expect(await suppressionsFor(tenantB)).toHaveLength(0);
    expect(await suppressionsFor(userId)).toHaveLength(1);
  });

  it("a topic cannot be registered by a second tenant", async () => {
    const tenantB = await createTestUser();
    await expect(registerTopic(tenantB, TEST_TOPIC_ARN)).rejects.toBeInstanceOf(
      TopicRegistrationError,
    );
    // Re-registering your own is a harmless no-op.
    await expect(registerTopic(userId, TEST_TOPIC_ARN)).resolves.toMatchObject({ userId });
  });

  it("refuses FIFO topics and non-topic ARNs", async () => {
    await expect(
      registerTopic(userId, "arn:aws:sns:us-east-1:123456789012:events.fifo"),
    ).rejects.toThrow(/FIFO/);
    await expect(registerTopic(userId, "not-an-arn")).rejects.toThrow(/not an SNS topic ARN/);
  });
});

describe("events that race ahead of markSent", () => {
  it("are stored unmatched, then applied when the worker records the message id", async () => {
    const created = await createQueuedLog({
      userId,
      environment: "production",
      fromAddress: "s@example.com",
      recipients: ["a@x.com"],
      subject: "s",
      idempotencyKey: null,
      tags: null,
    });
    if (created.outcome !== "created") throw new Error();
    await markSending(created.logId);
    const sesMessageId = "0100-raced";

    // SES accepted the message and SNS delivered the event before the worker
    // wrote the message id.
    const res = await post(sesNotification(signer, sesEvents.delivery(sesMessageId, ["a@x.com"])));
    expect(await res.json()).toMatchObject({ matched: false });
    expect((await logRow(created.logId)).status).toBe("sending");

    // The worker catches up.
    await markSent(created.logId, { messageId: sesMessageId, sesRequestId: "r" });
    expect(await reconcileEventsForLog(userId, sesMessageId)).toBe(1);

    expect((await logRow(created.logId)).status).toBe("delivered");
    const [event] = await getDb()
      .select()
      .from(snsEvents)
      .where(and(eq(snsEvents.userId, userId), eq(snsEvents.sesMessageId, sesMessageId)));
    expect(event?.logId).toBe(created.logId);

    // Running it again finds nothing left to apply.
    expect(await reconcileEventsForLog(userId, sesMessageId)).toBe(0);
  });
});

describe("webhook health (System Health: webhook lag)", () => {
  it("reports counts, unmatched events and lag for the tenant only", async () => {
    const empty = await webhookStats(userId);
    expect(empty).toEqual({
      lastReceivedAt: null,
      last24h: 0,
      unmatched24h: 0,
      medianLagMs: null,
      maxLagMs: null,
    });

    const { sesMessageId } = await sentLog(["a@x.com"]);
    await post(sesNotification(signer, sesEvents.delivery(sesMessageId, ["a@x.com"])));
    await post(sesNotification(signer, sesEvents.bounce("0100-not-ours", ["b@x.com"])));

    const stats = await webhookStats(userId);
    expect(stats.last24h).toBe(2);
    expect(stats.unmatched24h).toBe(1);
    expect(stats.lastReceivedAt).toBeInstanceOf(Date);
    // The fixtures stamp events ~2s before they are posted.
    expect(stats.medianLagMs).toBeGreaterThan(1_000);
    expect(stats.medianLagMs).toBeLessThan(60_000);
    expect(stats.maxLagMs).toBeGreaterThanOrEqual(stats.medianLagMs!);

    expect((await webhookStats(await createTestUser())).last24h).toBe(0);
  });
});
