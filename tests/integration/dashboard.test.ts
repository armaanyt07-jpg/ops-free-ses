import { randomUUID } from "node:crypto";

import { Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auditLogs, emailLogs, snsEvents, suppressionList, type EmailStatus } from "@/db/schema";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Phase 4 — the dashboard's server side, against real PostgreSQL and Redis.
 *
 * Pages are thin; what they show comes from these functions. Each is tested
 * for the thing that would make a dashboard lie: wrong tenant, wrong
 * environment, wrong window, wrong arithmetic.
 */
const tenant = vi.hoisted(() => ({ current: { id: "", email: "", displayName: null as string | null } }));
const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("@/server/tenant", () => ({
  requireTenant: async () => tenant.current,
  getTenant: async () => tenant.current,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const describeSesAccount = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ses/client", () => ({
  describeSesAccount,
  sendViaSes: vi.fn(),
  createSesClient: vi.fn(),
}));

let redis: TestRedis;
beforeAll(async () => {
  redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
}, 30_000);

const activity = await import("@/server/activity");
const { rotateApiKey, createApiKey, authenticateApiKey, listApiKeys } = await import("@/server/api-keys");
const suppression = await import("@/server/suppression");
const { getQueueHealth } = await import("@/server/queue-health");
const { storeCredential, listCredentials, revalidateCredential } = await import("@/server/credentials");
const { getActiveEnvironment } = await import("@/server/environment");
const { switchEnvironment, sendTestEmail } = await import("@/app/dashboard/actions");
const { closeSendQueue, getSendQueue, SEND_QUEUE_NAME } = await import("@/lib/queue/send-queue");

let userId: string;

const ACCOUNT = {
  productionAccessEnabled: false,
  maxSendRate: 1,
  max24HourSend: 200,
  sentLast24Hours: 12,
  enforcementStatus: "HEALTHY",
};

beforeEach(async () => {
  vi.clearAllMocks();
  jar.clear();
  describeSesAccount.mockResolvedValue(ACCOUNT);
  await redis.flush();
  await resetTestDb();
  userId = await createTestUser("dev@example.test");
  tenant.current = { id: userId, email: "dev@example.test", displayName: null };
});

afterAll(async () => {
  await closeSendQueue().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

async function log(
  overrides: Partial<typeof emailLogs.$inferInsert> & { status?: EmailStatus } = {},
) {
  const [row] = await getDb()
    .insert(emailLogs)
    .values({
      userId,
      environment: "production",
      status: "sent",
      fromAddress: "app@example.com",
      recipients: ["alice@example.com"],
      subject: "Welcome",
      ...overrides,
    })
    .returning();
  return row!;
}

const PRODUCTION = { q: undefined } as const;

describe("activity explorer", () => {
  it("is scoped to the tenant and the environment", async () => {
    await log({ subject: "mine, production" });
    await log({ subject: "mine, staging", environment: "staging" });
    const other = await createTestUser();
    await log({ subject: "theirs", userId: other });

    const page = await activity.searchActivity(userId, "production", PRODUCTION);
    expect(page.rows.map((r) => r.subject)).toEqual(["mine, production"]);
    expect(page.total).toBe(1);
  });

  it.each([
    ["a recipient", "bob@corp"],
    ["a subject word", "invoice"],
    ["the sender", "billing@"],
    ["an SES message id", "0100-abc"],
  ])("finds by %s", async (_label, q) => {
    await log({ subject: "Your invoice", recipients: ["bob@corp.com"], fromAddress: "billing@example.com", messageId: "0100-abc-def" });
    await log({ subject: "Unrelated" });
    const page = await activity.searchActivity(userId, "production", { q });
    expect(page.rows.map((r) => r.subject)).toEqual(["Your invoice"]);
  });

  it("finds by pasted log id", async () => {
    const target = await log({ subject: "target" });
    await log();
    const page = await activity.searchActivity(userId, "production", { q: target.id.toUpperCase() });
    expect(page.rows.map((r) => r.id)).toEqual([target.id]);
  });

  it("treats LIKE metacharacters literally", async () => {
    await log({ subject: "100% off" });
    await log({ subject: "1000 off" });
    const page = await activity.searchActivity(userId, "production", { q: "100%" });
    expect(page.rows.map((r) => r.subject)).toEqual(["100% off"]);
  });

  it("filters by status, error code and date range", async () => {
    const now = Date.now();
    await log({ status: "failed", errorCode: "MessageRejected", queuedAt: new Date(now - 2 * DAY) });
    await log({ status: "failed", errorCode: "NO_ACTIVE_CREDENTIAL", queuedAt: new Date(now - 2 * DAY) });
    await log({ status: "failed", errorCode: "MessageRejected", queuedAt: new Date(now - 10 * DAY) });
    await log({ status: "delivered" });

    const byStatus = await activity.searchActivity(userId, "production", { status: "failed" });
    expect(byStatus.total).toBe(3);

    const byError = await activity.searchActivity(userId, "production", { errorCode: "MessageRejected" });
    expect(byError.total).toBe(2);

    const recent = await activity.searchActivity(userId, "production", {
      errorCode: "MessageRejected",
      from: new Date(now - 5 * DAY),
    });
    expect(recent.total).toBe(1);
  });

  it("paginates newest first with accurate totals", async () => {
    const now = Date.now();
    for (let i = 0; i < 7; i++) await log({ subject: `m${i}`, queuedAt: new Date(now - i * HOUR) });

    const first = await activity.searchActivity(userId, "production", {}, 1, 3);
    const third = await activity.searchActivity(userId, "production", {}, 3, 3);
    expect(first).toMatchObject({ total: 7, pageCount: 3 });
    expect(first.rows.map((r) => r.subject)).toEqual(["m0", "m1", "m2"]);
    expect(third.rows.map((r) => r.subject)).toEqual(["m6"]);
  });
});

describe("message detail", () => {
  it("returns the log with its matched events, in order", async () => {
    const row = await log({ messageId: "0100-x" });
    const later = new Date();
    const earlier = new Date(later.getTime() - 60_000);
    for (const [type, at] of [["Complaint", later], ["Delivery", earlier]] as const) {
      await getDb().insert(snsEvents).values({
        messageId: randomUUID(),
        userId,
        topicArn: "arn:aws:sns:us-east-1:123456789012:t",
        messageType: "Notification",
        eventType: type,
        sesMessageId: "0100-x",
        logId: row.id,
        eventAt: at,
      });
    }

    const detail = await activity.getMessageDetail(userId, row.id);
    expect(detail?.log.id).toBe(row.id);
    expect(detail?.events.map((e) => e.eventType)).toEqual(["Delivery", "Complaint"]);
  });

  it("is invisible to another tenant, and rejects non-ids", async () => {
    const row = await log();
    expect(await activity.getMessageDetail(await createTestUser(), row.id)).toBeNull();
    expect(await activity.getMessageDetail(userId, "not-a-uuid")).toBeNull();
  });
});

describe("delivery statistics", () => {
  it("counts only the window, tenant and environment asked for", async () => {
    const now = Date.now();
    await log({ status: "delivered" });
    await log({ status: "delivered" });
    await log({ status: "bounced" });
    await log({ status: "sent" });
    await log({ status: "failed" });
    await log({ status: "delivered", queuedAt: new Date(now - 3 * DAY) });
    await log({ status: "delivered", environment: "staging" });
    await log({ status: "delivered", userId: await createTestUser() });

    const day = await activity.deliveryStats(userId, "production", 1);
    expect(day).toMatchObject({ total: 5, delivered: 2, bounced: 1, sent: 1, failed: 1, reachedSes: 4, withOutcome: 3 });
    expect(day.bounceRate).toBeCloseTo(1 / 4);

    const week = await activity.deliveryStats(userId, "production", 7);
    expect(week.delivered).toBe(3);
  });

  it("volume series has one bucket per day (hour for 24h), empty ones included", async () => {
    const now = Date.now();
    await log({ status: "delivered" });
    await log({ status: "bounced" });
    await log({ status: "suppressed" });
    await log({ status: "queued", queuedAt: new Date(now - 2 * DAY) });

    const week = await activity.volumeSeries(userId, "production", 7);
    expect(week).toHaveLength(7);
    const today = week.at(-1)!;
    expect(today).toMatchObject({ delivered: 1, problems: 1, notSent: 1, pending: 0 });
    expect(week.at(-3)!.pending).toBe(1);
    expect(week.reduce((n, b) => n + b.delivered + b.pending + b.problems + b.notSent, 0)).toBe(4);

    const hourly = await activity.volumeSeries(userId, "production", 1);
    expect(hourly).toHaveLength(24);
    expect(hourly.at(-1)!.delivered).toBe(1);

    // Buckets are contiguous and in order.
    for (let i = 1; i < week.length; i++) {
      expect(week[i]!.start.getTime() - week[i - 1]!.start.getTime()).toBe(DAY);
    }
  });
});

describe("error tracking", () => {
  it("groups failures by cause, most frequent first, with the latest example", async () => {
    const now = Date.now();
    await log({ status: "failed", errorCode: "MessageRejected", errorMessage: "old", queuedAt: new Date(now - HOUR) });
    const latest = await log({ status: "failed", errorCode: "MessageRejected", errorMessage: "new" });
    await log({ status: "suppressed", errorCode: "RECIPIENT_SUPPRESSED" });
    await log({ status: "failed", errorCode: "MessageRejected", environment: "staging" });

    const groups = await activity.errorGroups(userId, "production", 7);
    expect(groups.map((g) => [g.errorCode, g.count])).toEqual([
      ["MessageRejected", 2],
      ["RECIPIENT_SUPPRESSED", 1],
    ]);
    expect(groups[0]).toMatchObject({ sampleMessage: "new", sampleLogId: latest.id });
  });

  it("breaks bounces down by type for this environment only", async () => {
    const prod = await log({ status: "bounced" });
    const staging = await log({ status: "bounced", environment: "staging" });
    const event = (logId: string, payload: object, eventType = "Bounce") =>
      getDb().insert(snsEvents).values({
        messageId: randomUUID(),
        userId,
        topicArn: "arn:aws:sns:us-east-1:123456789012:t",
        messageType: "Notification",
        eventType,
        sesMessageId: "x",
        logId,
        payload,
      });
    await event(prod.id, { bounceType: "Permanent", bounceSubType: "General" });
    await event(prod.id, { bounceType: "Permanent", bounceSubType: "General" });
    await event(prod.id, { bounceType: "Transient", bounceSubType: "MailboxFull" });
    await event(prod.id, { feedbackType: "abuse" }, "Complaint");
    await event(staging.id, { bounceType: "Permanent", bounceSubType: "General" });

    const groups = await activity.bounceGroups(userId, "production", 7);
    expect(groups).toEqual([
      { eventType: "Bounce", kind: "Permanent", subType: "General", count: 2 },
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 1 }),
    ]);
    expect(groups.find((g) => g.eventType === "Complaint")?.kind).toBe("abuse");
  });
});

describe("API key rotation", () => {
  it("issues a working replacement and keeps the old key alive for the grace window", async () => {
    const original = await createApiKey(userId, "backend", "production");
    const rotated = await rotateApiKey(userId, original.summary.id, "24h");

    expect(rotated?.summary).toMatchObject({ name: "backend", environment: "production" });
    expect((await authenticateApiKey(rotated!.secret)).ok).toBe(true);
    expect((await authenticateApiKey(original.secret)).ok).toBe(true);

    const deadline = rotated!.oldKeyExpiresAt.getTime() - Date.now();
    expect(deadline).toBeGreaterThan(23 * HOUR);
    expect(deadline).toBeLessThanOrEqual(24 * HOUR);
  });

  it("the old key stops working once its deadline passes", async () => {
    const original = await createApiKey(userId, "backend", "production");
    await rotateApiKey(userId, original.summary.id, "1h");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * HOUR);
    try {
      expect(await authenticateApiKey(original.secret)).toEqual({ ok: false, reason: "expired" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("`now` revokes the old key immediately", async () => {
    const original = await createApiKey(userId, "backend", "staging");
    await rotateApiKey(userId, original.summary.id, "now");
    expect(await authenticateApiKey(original.secret)).toEqual({ ok: false, reason: "revoked" });
  });

  it("never extends an earlier deadline", async () => {
    const original = await createApiKey(userId, "k", "production", new Date(Date.now() + HOUR));
    const rotated = await rotateApiKey(userId, original.summary.id, "7d");
    expect(rotated!.oldKeyExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + HOUR);
  });

  it("refuses revoked keys and other tenants' keys", async () => {
    const original = await createApiKey(userId, "k", "production");
    expect(await rotateApiKey(await createTestUser(), original.summary.id, "24h")).toBeNull();
    await rotateApiKey(userId, original.summary.id, "now");
    expect(await rotateApiKey(userId, original.summary.id, "24h")).toBeNull();
    expect((await listApiKeys(userId)).length).toBe(2);
  });
});

describe("suppression management", () => {
  const change = (email: string, note = "customer asked") => ({
    userId,
    actor: "dev@example.test",
    email,
    note,
  });

  it("adds and removes with an audit row for each, in the same transaction", async () => {
    await suppression.addSuppression(change("Opt.Out@Example.com", "unsubscribed by phone"));
    expect(await suppression.findSuppressed(userId, ["opt.out@example.com"])).toEqual(["opt.out@example.com"]);

    await suppression.removeSuppression(change("opt.out@example.com", "re-subscribed"));
    expect(await suppression.findSuppressed(userId, ["opt.out@example.com"])).toEqual([]);

    const audit = await suppression.listSuppressionAudit(userId);
    expect(audit.map((a) => [a.action, a.target, a.actor, (a.detail as { note: string }).note])).toEqual([
      ["suppression.remove", "opt.out@example.com", "dev@example.test", "re-subscribed"],
      ["suppression.add", "opt.out@example.com", "dev@example.test", "unsubscribed by phone"],
    ]);
  });

  it("removal keeps the row — and its original reason — for history", async () => {
    await getDb().insert(suppressionList).values({ userId, email: "gone@x.com", reason: "hard_bounce", sourceEventId: "sns-1" });
    await suppression.removeSuppression(change("gone@x.com"));

    const [row] = await getDb().select().from(suppressionList).where(eq(suppressionList.email, "gone@x.com"));
    expect(row).toMatchObject({ active: false, reason: "hard_bounce", sourceEventId: "sns-1" });
    const [entry] = await suppression.listSuppressionAudit(userId);
    expect(entry?.detail).toMatchObject({ previous: { reason: "hard_bounce", sourceEventId: "sns-1" } });
  });

  it("refuses no-op changes and bad input, writing no audit row", async () => {
    await suppression.addSuppression(change("a@x.com"));
    await expect(suppression.addSuppression(change("a@x.com"))).rejects.toThrow(/already suppressed/);
    await expect(suppression.removeSuppression(change("never@x.com"))).rejects.toThrow(/not currently/);
    await expect(suppression.addSuppression(change("not an email"))).rejects.toThrow(/valid email/);
    expect(await getDb().select().from(auditLogs)).toHaveLength(1);
  });

  it("a failed audit write rolls the change back", async () => {
    await getDb().execute("ALTER TABLE audit_logs RENAME TO audit_logs_away");
    try {
      await expect(suppression.addSuppression(change("x@x.com"))).rejects.toThrow();
    } finally {
      await getDb().execute("ALTER TABLE audit_logs_away RENAME TO audit_logs");
    }
    expect(await suppression.findSuppressed(userId, ["x@x.com"])).toEqual([]);
  });

  it("is per tenant, and paginates with totals", async () => {
    for (let i = 0; i < 5; i++) await suppression.addSuppression(change(`u${i}@x.com`));
    await getDb().insert(suppressionList).values({ userId: await createTestUser(), email: "u0@x.com", reason: "manual" });

    const page = await suppression.listSuppressions(userId, { page: 2, pageSize: 2 });
    expect(page).toMatchObject({ total: 5, pageCount: 3, page: 2 });
    expect(page.rows).toHaveLength(2);
    expect((await suppression.listSuppressions(userId, { search: "u3" })).rows.map((r) => r.email)).toEqual(["u3@x.com"]);
  });
});

describe("queue health is tenant-safe", () => {
  it("lists only this tenant's dead-lettered jobs", async () => {
    const other = await createTestUser();
    const queue = new Queue(SEND_QUEUE_NAME, { connection: { host: "127.0.0.1", port: redis.port } });
    // Fail one job per tenant through a real worker, as production would.
    const worker = new Worker(
      SEND_QUEUE_NAME,
      async (job) => {
        throw new Error(
          job.data.userId === userId ? "mine" : "Email address is not verified: secret@theirs.com",
        );
      },
      { connection: { host: "127.0.0.1", port: redis.port } },
    );
    try {
      await queue.add("send", { userId, logId: randomUUID() }, { attempts: 1 });
      await queue.add("send", { userId: other, logId: randomUUID() }, { attempts: 1 });
      for (let i = 0; i < 100 && (await queue.getFailedCount()) < 2; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }

      const health = await getQueueHealth(userId);
      expect(health.depth?.failed).toBe(2); // platform-wide count
      expect(health.deadLetter.map((d) => d.failedReason)).toEqual(["mine"]);
      expect(JSON.stringify(health)).not.toContain("secret@theirs.com");
    } finally {
      await worker.close();
      await queue.close();
    }
  }, 20_000);
});

describe("AWS account snapshot", () => {
  const input = () => ({
    userId,
    environment: "staging" as const,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    awsRegion: "ap-south-1",
  });

  it("is stored on save and refreshed on re-validate", async () => {
    await storeCredential(input());
    expect((await listCredentials(userId))[0]?.account).toEqual(ACCOUNT);

    describeSesAccount.mockResolvedValue({ ...ACCOUNT, productionAccessEnabled: true, sentLast24Hours: 150 });
    await revalidateCredential(userId, "staging");
    expect((await listCredentials(userId))[0]?.account).toMatchObject({ productionAccessEnabled: true, sentLast24Hours: 150 });
  });

  it("re-validate reports a specific reason when AWS refuses", async () => {
    await storeCredential(input());
    describeSesAccount.mockRejectedValue(Object.assign(new Error("x"), { name: "AccessDeniedException" }));
    await expect(revalidateCredential(userId, "staging")).rejects.toThrow(/ses:GetAccount/);
  });
});

describe("environment switching", () => {
  it("defaults to the environment that has a credential", async () => {
    expect(await getActiveEnvironment(userId)).toBe("production");
    await storeCredential({
      userId,
      environment: "staging",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      awsRegion: "ap-south-1",
    });
    expect(await getActiveEnvironment(userId)).toBe("staging");
  });

  it("follows the switcher, and ignores a tampered cookie", async () => {
    const form = new FormData();
    form.set("environment", "staging");
    await switchEnvironment(form);
    expect(await getActiveEnvironment(userId)).toBe("staging");

    jar.set("ops_env", "admin");
    expect(await getActiveEnvironment(userId)).toBe("production");

    const bad = new FormData();
    bad.set("environment", "admin");
    await switchEnvironment(bad);
    expect(jar.get("ops_env")).toBe("admin"); // unchanged: the action refused it
  });
});

describe("dashboard test send", () => {
  function form(to = "success@simulator.amazonses.com") {
    const f = new FormData();
    f.set("from", "me@example.com");
    f.set("to", to);
    f.set("subject", "Test");
    f.set("text", "Hello");
    return f;
  }

  it("goes through the real pipeline: a log in the active environment and a queued job", async () => {
    jar.set("ops_env", "staging");
    const result = await sendTestEmail({}, form());

    expect(result.sent?.environment).toBe("staging");
    const [row] = await getDb().select().from(emailLogs).where(eq(emailLogs.id, result.sent!.logId));
    expect(row).toMatchObject({ environment: "staging", status: "queued", tags: { source: "dashboard-test" } });
    expect(await getSendQueue().getJob(`log-${result.sent!.logId}`)).toBeDefined();
  });

  it("is refused for a suppressed recipient, like the API", async () => {
    await suppression.addSuppression({ userId, actor: "t", email: "gone@x.com", note: "test" });
    const result = await sendTestEmail({}, form("gone@x.com"));
    expect(result.error).toMatch(/suppression list/);
    expect(await getDb().select().from(emailLogs)).toHaveLength(0);
  });

  it("validates its input", async () => {
    expect((await sendTestEmail({}, form("nope"))).error).toMatch(/valid recipient/);
  });
});
