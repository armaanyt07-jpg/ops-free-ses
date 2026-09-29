import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailLogs, snsEvents, suppressionList } from "@/db/schema";

import { createTestUser } from "../support/factories";
import { createSnsSigner, sesEvents, sesNotification, TEST_TOPIC_ARN } from "../support/sns";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

/**
 * Phase 7 — webhook replay (SRS §16 "Webhook replay tests").
 *
 * SNS delivers at least once and in no particular order, and after a database
 * restore every event since the backup may be delivered again. The final state
 * must not depend on order, duplication, or replay.
 */
const fetchSigningCertificate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sns/certificate", () => ({ fetchSigningCertificate }));
vi.mock("@/lib/sns/subscription", () => ({ confirmSubscription: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()) }));

const { processNotification } = await import("@/server/sns-events");
const { registerTopic } = await import("@/server/sns-topics");
const { createQueuedLog, markSent } = await import("@/server/email-logs");
const { NextRequest } = await import("next/server");
const { POST: webhook } = await import("@/app/api/v1/webhooks/aws-sns/route");

const signer = createSnsSigner();
const RECIPIENTS = ["a@x.com", "b@x.com", "c@x.com", "d@x.com"];
let userId: string;

beforeEach(async () => {
  fetchSigningCertificate.mockResolvedValue(signer.certificate);
  await resetTestDb();
  userId = await createTestUser();
  await registerTopic(userId, TEST_TOPIC_ARN);
});

afterAll(async () => {
  await closeTestDb();
});

function evidence(name: string, data: Record<string, unknown>) {
  mkdirSync("test-results", { recursive: true });
  appendFileSync("test-results/resilience.jsonl", `${JSON.stringify({ test: name, at: new Date().toISOString(), ...data })}\n`);
}

/** A seeded PRNG, so a failure is reproducible from its seed. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

async function freshLog() {
  const created = await createQueuedLog({ userId, environment: "production", fromAddress: "s@x.com", recipients: RECIPIENTS, subject: "s", idempotencyKey: null, tags: null });
  if (created.outcome !== "created") throw new Error();
  const sesId = `0100-${randomUUID()}`;
  await markSent(created.logId, { messageId: sesId, sesRequestId: "r" });
  return { logId: created.logId, sesId };
}

/** The history of one message: deliveries, a hard bounce, a soft bounce, a complaint after delivery. */
function history(sesId: string) {
  return [
    sesNotification(signer, sesEvents.delivery(sesId, ["a@x.com", "b@x.com"])),
    sesNotification(signer, sesEvents.bounce(sesId, ["c@x.com"], "Permanent")),
    sesNotification(signer, sesEvents.bounce(sesId, ["d@x.com"], "Transient")),
    sesNotification(signer, sesEvents.complaint(sesId, ["a@x.com"])),
  ];
}

const topic = () => ({ userId, topicArn: TEST_TOPIC_ARN });

async function finalState(logId: string) {
  const [log] = await getDb().select().from(emailLogs).where(eq(emailLogs.id, logId));
  const recipients = (log?.providerEvent as { recipients?: Record<string, { status: string }> } | null)?.recipients ?? {};
  const suppressed = await getDb().select().from(suppressionList).where(eq(suppressionList.userId, userId));
  return {
    status: log?.status,
    complete: log?.completedAt !== null,
    recipients: Object.fromEntries(Object.entries(recipients).map(([k, v]) => [k, v.status]).sort()),
    suppressed: suppressed.filter((s) => s.active).map((s) => `${s.email}:${s.reason}`).sort(),
  };
}

const EXPECTED = {
  status: "complained",
  complete: true,
  recipients: { "a@x.com": "complained", "b@x.com": "delivered", "c@x.com": "bounced", "d@x.com": "bounced" },
  suppressed: ["a@x.com:complaint", "c@x.com:hard_bounce"],
};

describe("order and duplication do not matter", () => {
  it("200 random orderings with random duplicates all converge to the same state", async () => {
    const random = rng(20260927);
    for (let trial = 0; trial < 200; trial++) {
      await resetTestDb();
      userId = await createTestUser();
      await registerTopic(userId, TEST_TOPIC_ARN);
      const { logId, sesId } = await freshLog();

      const messages = history(sesId);
      const deliveries = [...messages, ...messages.filter(() => random() < 0.5)]; // duplicates
      deliveries.sort(() => random() - 0.5);
      for (const m of deliveries) await processNotification(topic(), m);

      expect(await finalState(logId), `trial ${trial}`).toEqual(EXPECTED);
    }
    evidence("webhook_order_and_duplication", { trials: 200, eventsPerTrial: "4 + random duplicates", seed: 20260927, divergent: 0 });
  }, 120_000);
});

describe("replay after a database restore", () => {
  it("replaying every event into restored state reproduces the same result", async () => {
    const { logId, sesId } = await freshLog();
    const messages = history(sesId);
    for (const m of messages) await processNotification(topic(), m);
    const before = await finalState(logId);

    // Restore to a backup taken just after the send: events, statuses and
    // suppressions since then are gone.
    await getDb().delete(snsEvents);
    await getDb().delete(suppressionList);
    await getDb().update(emailLogs).set({ status: "sent", providerEvent: null, completedAt: null }).where(eq(emailLogs.id, logId));

    // SNS redelivery / reconciliation replays everything, twice for good measure.
    for (const m of [...messages].reverse()) await processNotification(topic(), m);
    for (const m of messages) await processNotification(topic(), m);

    expect(await finalState(logId)).toEqual(before);
    expect(before).toEqual(EXPECTED);
    evidence("webhook_replay_after_restore", { events: 4, replayedTimes: 2, identical: true });
  });

  it("a captured, genuinely signed message replayed 25 times at once is applied once", async () => {
    const { sesId } = await freshLog();
    const message = sesNotification(signer, sesEvents.bounce(sesId, ["c@x.com"]));
    const post = () =>
      webhook(new NextRequest("https://app.test/api/v1/webhooks/aws-sns", { method: "POST", headers: { "content-type": "text/plain", "x-forwarded-for": "54.240.0.1" }, body: JSON.stringify(message) }));

    const results = await Promise.all(Array.from({ length: 25 }, post));
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.filter((b) => b.status === "processed")).toHaveLength(1);
    expect(bodies.filter((b) => b.status === "duplicate")).toHaveLength(24);
    expect(await getDb().select().from(snsEvents)).toHaveLength(1);
    evidence("webhook_concurrent_replay", { concurrentDeliveries: 25, applied: 1, duplicatesIgnored: 24 });
  });
});
