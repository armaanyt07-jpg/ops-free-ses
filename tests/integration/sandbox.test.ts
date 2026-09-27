import { randomUUID } from "node:crypto";

import { SESv2Client } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailLogs, snsEvents, snsTopics, verifiedDomains } from "@/db/schema";
import type { Draft } from "@/lib/sandbox/request";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

/**
 * Phase 6 — the assistant's server side on real PostgreSQL: facts offered
 * only when true, review bound to the exact text, isolation, and no AWS calls.
 */
const tenant = vi.hoisted(() => ({ current: { id: "", email: "dev@example.test", displayName: null } }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("@/server/tenant", () => ({ requireTenant: async () => tenant.current }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined), set: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const sandbox = await import("@/server/sandbox");
const { saveSandboxDraft, reviewSandboxRequest } = await import("@/app/dashboard/sandbox/actions");

const COMPLETE: Draft = {
  region: "ap-south-1",
  mailType: "TRANSACTIONAL",
  companyName: "Quokka Labs",
  websiteUrl: "https://quokka.example",
  useCase: "Quokka Labs is a bookkeeping app for freelancers. We send sign-up confirmations and password resets when users act.",
  emailTypes: ["account_verification"],
  dailyVolume: 500,
  acquisitionDetails: "Every recipient created their own account and typed in their address.",
  bounceHandling: "We stop sending to hard-bouncing addresses.",
  complaintHandling: "We remove complaining addresses immediately.",
  suppressionStrategy: "We check a suppression list before every send.",
};

let userId: string;
const sendSpy = vi.spyOn(SESv2Client.prototype, "send");

beforeEach(async () => {
  jar.clear();
  sendSpy.mockReset();
  sendSpy.mockRejectedValue(new Error("No AWS call is expected in this test"));
  await resetTestDb();
  userId = await createTestUser("dev@example.test");
  tenant.current = { id: userId, email: "dev@example.test", displayName: null };
});

afterAll(async () => {
  expect(sendSpy).not.toHaveBeenCalled();
  sendSpy.mockRestore();
  await closeTestDb();
});

async function verifiedDomain(domain: string, environment: "production" | "staging" = "production") {
  const [row] = await getDb()
    .insert(verifiedDomains)
    .values({
      userId,
      domain,
      environment,
      status: "verified",
      lastCheckedAt: new Date(),
      checkResult: { dkim: { status: "pass" }, spf: { status: "pass" }, dmarc: { status: "pass", policy: "reject" } },
    })
    .returning();
  return row!;
}

async function confirmTopic() {
  await getDb().insert(snsTopics).values({ userId, topicArn: `arn:aws:sns:ap-south-1:1:${randomUUID()}`, status: "confirmed" });
}

async function sesEvent(eventType = "Delivery", logId?: string) {
  await getDb().insert(snsEvents).values({
    messageId: randomUUID(), userId, topicArn: "arn:aws:sns:ap-south-1:1:t", messageType: "Notification",
    eventType, sesMessageId: "m", logId: logId ?? null,
  });
}

describe("facts are offered only when true", () => {
  it("offers only SES-verified domains in the environment", async () => {
    await verifiedDomain("good.example");
    await verifiedDomain("staging.example", "staging");
    await getDb().insert(verifiedDomains).values({ userId, domain: "pending.example", environment: "production", status: "pending" });

    const facts = await sandbox.collectFacts(userId, "production");
    expect(facts.domains.map((d) => [d.domain, d.dkim, d.dmarcPolicy])).toEqual([["good.example", "pass", "reject"]]);
  });

  it("automatic suppression: not with no SNS, not with a confirmed topic but no events, yes with both", async () => {
    expect((await sandbox.collectFacts(userId, "production")).autoSuppressionActive).toBe(false);
    await confirmTopic();
    expect((await sandbox.collectFacts(userId, "production")).autoSuppressionActive).toBe(false);
    await sesEvent("Delivery");
    expect((await sandbox.collectFacts(userId, "production")).autoSuppressionActive).toBe(true);
  });

  it("never offers metrics without measured outcomes — 0% would be a lie", async () => {
    for (let i = 0; i < 5; i++) {
      await getDb().insert(emailLogs).values({ userId, environment: "production", status: "sent", fromAddress: "a@x", recipients: ["b@x"], subject: "s" });
    }
    // Sent mail but no SNS: bounce rate would compute as 0%.
    expect((await sandbox.collectFacts(userId, "production")).metrics).toBeNull();

    await confirmTopic();
    const [log] = await getDb().insert(emailLogs).values({ userId, environment: "production", status: "bounced", fromAddress: "a@x", recipients: ["b@x"], subject: "s" }).returning();
    await sesEvent("Bounce", log!.id);
    const facts = await sandbox.collectFacts(userId, "production");
    expect(facts.metrics).toMatchObject({ days: 30, reachedSes: 6, withOutcome: 1 });
    expect(facts.metrics!.bounceRate).toBeCloseTo(1 / 6);
  });
});

describe("drafts and the human review", () => {
  it("builds only from a complete draft", async () => {
    await sandbox.saveDraft(userId, "production", { companyName: "Quokka" });
    const built = await sandbox.buildRequest(userId, "production");
    expect(built.ok).toBe(false);
    expect(!built.ok && built.missing).toContain("Bounce handling");
  });

  it("records a review only for the exact text shown", async () => {
    await sandbox.saveDraft(userId, "production", COMPLETE);
    const built = await sandbox.buildRequest(userId, "production");
    if (!built.ok) throw new Error("expected complete");

    await expect(sandbox.markReviewed(userId, "production", "dev@example.test", "0".repeat(64))).rejects.toThrow(/changed since it was displayed/);

    await sandbox.markReviewed(userId, "production", "dev@example.test", built.hash);
    const row = await sandbox.getSandboxRequest(userId, "production");
    expect(row).toMatchObject({ reviewedBy: "dev@example.test", reviewedHash: built.hash });
    expect(sandbox.isReviewed(row, built.hash)).toBe(true);
  });

  it("editing an answer clears the review", async () => {
    await sandbox.saveDraft(userId, "production", COMPLETE);
    const built = await sandbox.buildRequest(userId, "production");
    if (!built.ok) throw new Error();
    await sandbox.markReviewed(userId, "production", "dev", built.hash);

    await sandbox.saveDraft(userId, "production", { ...COMPLETE, dailyVolume: 600 });
    const row = await sandbox.getSandboxRequest(userId, "production");
    expect(row?.reviewedAt).toBeNull();
  });

  it("re-saving identical answers keeps the review", async () => {
    await sandbox.saveDraft(userId, "production", COMPLETE);
    const built = await sandbox.buildRequest(userId, "production");
    if (!built.ok) throw new Error();
    await sandbox.markReviewed(userId, "production", "dev", built.hash);
    await sandbox.saveDraft(userId, "production", COMPLETE);
    expect((await sandbox.getSandboxRequest(userId, "production"))?.reviewedAt).not.toBeNull();
  });

  it("a platform fact changing underneath invalidates the review", async () => {
    const domain = await verifiedDomain("good.example");
    await sandbox.saveDraft(userId, "production", { ...COMPLETE, include: { domains: [domain.id], autoSuppression: false, metrics: false } });
    const before = await sandbox.buildRequest(userId, "production");
    if (!before.ok) throw new Error();
    await sandbox.markReviewed(userId, "production", "dev", before.hash);

    // The domain is re-checked and DMARC now fails.
    await getDb()
      .update(verifiedDomains)
      .set({ checkResult: { dkim: { status: "pass" }, spf: { status: "pass" }, dmarc: { status: "fail", policy: null } } })
      .where(eq(verifiedDomains.id, domain.id));

    const after = await sandbox.buildRequest(userId, "production");
    if (!after.ok) throw new Error();
    expect(after.hash).not.toBe(before.hash);
    expect(sandbox.isReviewed(await sandbox.getSandboxRequest(userId, "production"), after.hash)).toBe(false);
  });

  it("is per tenant and per environment", async () => {
    await sandbox.saveDraft(userId, "production", COMPLETE);
    expect(await sandbox.getSandboxRequest(userId, "staging")).toBeNull();
    expect(await sandbox.getSandboxRequest(await createTestUser(), "production")).toBeNull();
  });
});

describe("actions", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("saves to the active environment and reports what is missing", async () => {
    jar.set("ops_env", "staging");
    const result = await saveSandboxDraft({}, form({ draft: JSON.stringify({ companyName: "Q" }) }));
    expect(result.missing).toContain("Website URL (https://…)");
    expect(await sandbox.getSandboxRequest(userId, "staging")).not.toBeNull();
  });

  it("rejects malformed drafts", async () => {
    expect((await saveSandboxDraft({}, form({ draft: "{nope" }))).error).toMatch(/could not be read/);
    expect((await saveSandboxDraft({}, form({ draft: JSON.stringify({ dailyVolume: -5 }) }))).error).toMatch(/dailyVolume/);
  });

  it("the review requires all three confirmations", async () => {
    await sandbox.saveDraft(userId, "production", COMPLETE);
    const built = await sandbox.buildRequest(userId, "production");
    if (!built.ok) throw new Error();

    const partial = await reviewSandboxRequest({}, form({ hash: built.hash, accurate: "on", estimates: "on" }));
    expect(partial.error).toMatch(/AWS makes the decision/);
    expect((await sandbox.getSandboxRequest(userId, "production"))?.reviewedAt).toBeNull();

    const full = await reviewSandboxRequest({}, form({ hash: built.hash, accurate: "on", estimates: "on", awsDecides: "on" }));
    expect(full.ok).toBe(true);
  });
});

describe("AWS review status comes only from AWS", () => {
  it("is read from GetAccount's ReviewDetails, verbatim", async () => {
    const { describeSesAccount } = await import("@/lib/ses/client");
    sendSpy.mockResolvedValueOnce({
      ProductionAccessEnabled: false,
      SendQuota: { MaxSendRate: 1, Max24HourSend: 200, SentLast24Hours: 0 },
      EnforcementStatus: "HEALTHY",
      Details: { ReviewDetails: { Status: "PENDING", CaseId: "case-123" } },
    } as never);

    const snapshot = await describeSesAccount({ accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "x".repeat(40), region: "ap-south-1" });
    expect(snapshot).toMatchObject({ reviewStatus: "PENDING", reviewCaseId: "case-123", productionAccessEnabled: false });
    sendSpy.mockClear(); // this call was the test's own; the suite asserts no others
  });

  it("is null when AWS reports no review", async () => {
    const { describeSesAccount } = await import("@/lib/ses/client");
    sendSpy.mockResolvedValueOnce({ ProductionAccessEnabled: false } as never);
    const snapshot = await describeSesAccount({ accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "x".repeat(40), region: "ap-south-1" });
    expect(snapshot.reviewStatus).toBeNull();
    sendSpy.mockClear();
  });
});
