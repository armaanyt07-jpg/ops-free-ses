import { randomUUID } from "node:crypto";

import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Phase 7 — the tenant-isolation matrix (SRS §16: "Tenant isolation prevents
 * cross-user access"; Appendix B: "Tenant isolation has automated negative
 * tests").
 *
 * Tenant A owns one of every resource. Tenant B then calls every tenant-scoped
 * read and write in src/server with A's identifiers. Every read must come back
 * empty, every write must be refused, and afterwards A's rows — in every table
 * — must be exactly as they were.
 */
vi.mock("@/lib/ses/client", () => ({
  describeSesAccount: vi.fn(async () => ({ productionAccessEnabled: false, maxSendRate: 1, max24HourSend: 200, sentLast24Hours: 0, enforcementStatus: "HEALTHY" })),
  getDomainIdentity: vi.fn(async () => ({ verificationStatus: "SUCCESS", dkimStatus: "SUCCESS", dkimTokens: [], verifiedForSending: true })),
  createDomainIdentity: vi.fn(),
  sendViaSes: vi.fn(),
  createSesClient: vi.fn(),
}));
vi.mock("@/lib/dns/resolver", () => ({
  lookupTxt: async () => ({ ok: true, records: [] }),
  lookupCname: async () => ({ ok: true, records: [] }),
}));

let redis: TestRedis;
beforeAll(async () => {
  redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
}, 30_000);

const credentials = await import("@/server/credentials");
const apiKeys = await import("@/server/api-keys");
const domains = await import("@/server/domains");
const activity = await import("@/server/activity");
const logs = await import("@/server/email-logs");
const suppression = await import("@/server/suppression");
const topics = await import("@/server/sns-topics");
const events = await import("@/server/sns-events");
const templates = await import("@/server/templates");
const sandbox = await import("@/server/sandbox");
const { getQueueHealth, getSendJobState } = await import("@/server/queue-health");
const { SEND_QUEUE_NAME, jobIdForLog, closeSendQueue } = await import("@/lib/queue/send-queue");

const A = { id: "", logId: "", keyId: "", credentialId: "", domainId: "", topicId: "", topicArn: "", templateId: "" };
let B = "";

/** Every row tenant A owns, in every table — the "before" and "after". */
async function snapshotOfA() {
  const db = getDb();
  const out: Record<string, unknown> = {};
  for (const [name, table] of Object.entries({
    users: schema.users,
    aws_credentials: schema.awsCredentials,
    api_keys: schema.apiKeys,
    verified_domains: schema.verifiedDomains,
    email_logs: schema.emailLogs,
    suppression_list: schema.suppressionList,
    sns_topics: schema.snsTopics,
    sns_events: schema.snsEvents,
    email_templates: schema.emailTemplates,
    email_template_versions: schema.emailTemplateVersions,
    audit_logs: schema.auditLogs,
    sandbox_requests: schema.sandboxRequests,
  })) {
    const column = name === "users" ? (table as typeof schema.users).id : (table as typeof schema.apiKeys).userId;
    out[name] = await db.select().from(table as typeof schema.apiKeys).where(eq(column, A.id));
  }
  return JSON.parse(JSON.stringify(out));
}

let before: unknown;

beforeAll(async () => {
  await resetTestDb();
  A.id = await createTestUser("a@example.test");
  B = await createTestUser("b@example.test");

  A.credentialId = (await credentials.storeCredential({ userId: A.id, environment: "production", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", awsRegion: "ap-south-1" })).credential.id;
  A.keyId = (await apiKeys.createApiKey(A.id, "a-key", "production")).summary.id;

  const [domain] = await getDb().insert(schema.verifiedDomains).values({ userId: A.id, domain: "a.example", environment: "production", status: "verified", awsRegion: "ap-south-1", lastCheckedAt: new Date() }).returning();
  A.domainId = domain!.id;

  const created = await logs.createQueuedLog({ userId: A.id, environment: "production", fromAddress: "x@a.example", recipients: ["victim@customer.example"], subject: "A's secret subject", idempotencyKey: "a-idem", tags: null });
  if (created.outcome !== "created") throw new Error();
  A.logId = created.logId;
  await logs.markSent(A.logId, { messageId: "0100-a", sesRequestId: "r" });

  A.topicArn = "arn:aws:sns:ap-south-1:111111111111:a-events";
  A.topicId = (await topics.registerTopic(A.id, A.topicArn)).id;
  await getDb().insert(schema.snsEvents).values({ messageId: randomUUID(), userId: A.id, topicArn: A.topicArn, messageType: "Notification", eventType: "Bounce", sesMessageId: "0100-a", logId: A.logId, payload: { bounceType: "Permanent" } });

  await suppression.addSuppression({ userId: A.id, actor: "a@example.test", email: "blocked@customer.example", note: "A's reason" });

  const t = await templates.createTemplate(A.id, "a@example.test", { name: "a-welcome", subject: "Hi {{n}}", html: "<p>{{n}}</p>", text: null, variables: [{ name: "n", required: true, sample: "x" }] });
  A.templateId = t.id;
  await templates.updateTemplate(A.id, "a@example.test", t.id, { name: "a-welcome", subject: "Hello {{n}}", html: "<p>{{n}}</p>", text: null, variables: [{ name: "n", required: true, sample: "x" }] });

  await sandbox.saveDraft(A.id, "production", { companyName: "A Corp" });

  const q = new Queue(SEND_QUEUE_NAME, { connection: { host: "127.0.0.1", port: redis.port } });
  await q.add("send", { userId: A.id, logId: A.logId }, { jobId: jobIdForLog(A.logId) });
  await q.close();

  before = await snapshotOfA();
}, 60_000);

afterAll(async () => {
  await closeSendQueue().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

describe("tenant B, using tenant A's identifiers", () => {
  it("credentials: sees none, can change none, decrypts none", async () => {
    expect(await credentials.listCredentials(B)).toEqual([]);
    expect(await credentials.setCredentialActive(B, A.credentialId, false)).toBe(false);
    expect(await credentials.deleteCredential(B, A.credentialId)).toBe(false);
    expect(await credentials.loadSesCredentials(B, "production")).toBeNull();
    expect(await credentials.loadDeliveryCredential(B, "production")).toBeNull();
    expect(await credentials.revalidateCredential(B, "production")).toBeNull();
  });

  it("API keys", async () => {
    expect(await apiKeys.listApiKeys(B)).toEqual([]);
    expect(await apiKeys.revokeApiKey(B, A.keyId)).toBe(false);
    expect(await apiKeys.rotateApiKey(B, A.keyId, "now")).toBeNull();
  });

  it("domains", async () => {
    expect(await domains.listDomains(B)).toEqual([]);
    expect(await domains.findDomain(B, "a.example", "production")).toBeNull();
    expect(await domains.checkDomain(B, A.domainId)).toBeNull();
    expect(await domains.checkDomainIfStale(B, A.domainId, 0)).toBeNull();
    expect(await domains.removeDomain(B, A.domainId)).toBe(false);
  });

  it("activity, message detail, statistics, errors", async () => {
    expect((await activity.searchActivity(B, "production", { q: "secret subject" })).total).toBe(0);
    expect((await activity.searchActivity(B, "production", { q: A.logId })).total).toBe(0);
    expect(await activity.getMessageDetail(B, A.logId)).toBeNull();
    expect((await activity.deliveryStats(B, "production", 30)).total).toBe(0);
    expect((await activity.volumeSeries(B, "production", 30)).every((b) => b.delivered + b.pending + b.problems + b.notSent === 0)).toBe(true);
    expect(await activity.errorGroups(B, "production", 30)).toEqual([]);
    expect(await activity.bounceGroups(B, "production", 30)).toEqual([]);
    expect(await logs.listRecentActivity(B)).toEqual([]);
  });

  it("queue: another tenant's job and dead letters read as absent", async () => {
    expect(await getSendJobState(B, A.logId)).toBeNull();
    expect(await getSendJobState(A.id, A.logId)).not.toBeNull(); // the positive control
    expect((await getQueueHealth(B)).deadLetter).toEqual([]);
  });

  it("suppression", async () => {
    expect(await suppression.findSuppressed(B, ["blocked@customer.example"])).toEqual([]);
    expect((await suppression.listSuppressions(B, { includeInactive: true })).total).toBe(0);
    await expect(suppression.removeSuppression({ userId: B, actor: "b", email: "blocked@customer.example", note: "x" })).rejects.toThrow(/not currently suppressed/);
    expect(await suppression.listSuppressionAudit(B)).toEqual([]);
  });

  it("SNS topics and events", async () => {
    expect(await topics.listTopics(B)).toEqual([]);
    expect(await topics.removeTopic(B, A.topicId)).toBe(false);
    await expect(topics.registerTopic(B, A.topicArn)).rejects.toThrow(/another account/);
    expect(await events.listRecentEvents(B)).toEqual([]);
    expect((await events.webhookStats(B)).last24h).toBe(0);
    expect(await events.reconcileEventsForLog(B, "0100-a")).toBe(0);
  });

  it("templates and versions", async () => {
    expect(await templates.getTemplate(B, A.templateId)).toBeNull();
    expect((await templates.listTemplates(B, { includeArchived: true })).total).toBe(0);
    expect(await templates.listVersions(B, A.templateId)).toEqual([]);
    expect(await templates.getVersion(B, A.templateId, 1)).toBeNull();
    await expect(templates.updateTemplate(B, "b", A.templateId, { name: "x", subject: "s", html: "<p>h</p>", text: null, variables: [] })).rejects.toThrow(/not found/);
    await expect(templates.restoreVersion(B, "b", A.templateId, 1)).rejects.toThrow(/does not exist/);
    expect(await templates.setTemplateActive(B, A.templateId, false)).toBe(false);
    expect(await templates.renderTemplateForSend(B, A.templateId, { n: "x" })).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("sandbox-exit drafts", async () => {
    expect(await sandbox.getSandboxRequest(B, "production")).toBeNull();
    const built = await sandbox.buildRequest(B, "production");
    expect(JSON.stringify(built)).not.toContain("A Corp");
    expect((await sandbox.collectFacts(B, "production")).domains).toEqual([]);
  });

  it("…and afterwards every one of A's rows, in every table, is unchanged", async () => {
    expect(await snapshotOfA()).toEqual(before);
    // The snapshot is not vacuous.
    const snap = before as Record<string, unknown[]>;
    for (const table of Object.keys(snap)) expect(snap[table]!.length, table).toBeGreaterThan(0);
  });
});
