import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { emailLogs } from "@/db/schema";
import {
  createQueuedLog,
  listRecentActivity,
  markFailed,
  markSending,
  markSent,
} from "@/server/email-logs";

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

function logInput(overrides: Partial<Parameters<typeof createQueuedLog>[0]> = {}) {
  return {
    userId,
    environment: "production" as const,
    fromAddress: "noreply@example.com",
    recipients: ["alice@example.com"],
    subject: "Welcome",
    idempotencyKey: null as string | null,
    tags: null as Record<string, string> | null,
    ...overrides,
  };
}

describe("createQueuedLog", () => {
  it("creates a row in `queued`", async () => {
    const result = await createQueuedLog(logInput());
    expect(result.outcome).toBe("created");

    const [row] = await getDb()
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.id, result.logId));

    expect(row?.status).toBe("queued");
    expect(row?.recipients).toEqual(["alice@example.com"]);
    expect(row?.sentAt).toBeNull();
  });

  it("persists tags and multiple recipients", async () => {
    const result = await createQueuedLog(
      logInput({
        recipients: ["a@example.com", "b@example.com"],
        tags: { campaign: "onboarding" },
      }),
    );

    const [row] = await getDb()
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.id, result.logId));

    expect(row?.recipients).toEqual(["a@example.com", "b@example.com"]);
    expect(row?.tags).toEqual({ campaign: "onboarding" });
  });

  // NULLs do not collide in a PostgreSQL unique index, so unkeyed requests
  // must never be treated as duplicates of one another.
  it("allows unlimited requests with no idempotency key", async () => {
    const a = await createQueuedLog(logInput());
    const b = await createQueuedLog(logInput());
    const c = await createQueuedLog(logInput());

    expect(new Set([a.logId, b.logId, c.logId]).size).toBe(3);
  });

  it("reports a repeat idempotency key as a duplicate", async () => {
    const first = await createQueuedLog(
      logInput({ idempotencyKey: "order-42" }),
    );
    const second = await createQueuedLog(
      logInput({ idempotencyKey: "order-42" }),
    );

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("duplicate");
    if (second.outcome !== "duplicate") return;

    // The caller is pointed at the original record.
    expect(second.logId).toBe(first.logId);
    expect(second.status).toBe("queued");
  });

  it("reports the original's current status on a duplicate", async () => {
    const first = await createQueuedLog(
      logInput({ idempotencyKey: "order-43" }),
    );
    await markSent(first.logId, { messageId: "m-1", sesRequestId: "r-1" });

    const second = await createQueuedLog(
      logInput({ idempotencyKey: "order-43" }),
    );

    expect(second.outcome).toBe("duplicate");
    if (second.outcome !== "duplicate") return;
    expect(second.status).toBe("sent");
  });

  it("writes only one row for a repeated key", async () => {
    await createQueuedLog(logInput({ idempotencyKey: "order-44" }));
    await createQueuedLog(logInput({ idempotencyKey: "order-44" }));

    const rows = await getDb()
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.userId, userId));

    expect(rows).toHaveLength(1);
  });

  /**
   * Uniqueness is delegated to PostgreSQL rather than a read-then-write check,
   * so concurrent requests carrying the same key cannot both be accepted.
   */
  it("accepts exactly one of many concurrent requests sharing a key", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createQueuedLog(logInput({ idempotencyKey: "concurrent-1" })),
      ),
    );

    const created = results.filter((r) => r.outcome === "created");
    expect(created).toHaveLength(1);

    // Every duplicate points at the single accepted record.
    for (const result of results) {
      expect(result.logId).toBe(created[0]!.logId);
    }
  });

  // Idempotency is per tenant: one customer's key must not block another's.
  it("scopes idempotency keys to the tenant", async () => {
    const mine = await createQueuedLog(
      logInput({ idempotencyKey: "shared-key" }),
    );
    const theirs = await createQueuedLog(
      logInput({ userId: otherUserId, idempotencyKey: "shared-key" }),
    );

    expect(mine.outcome).toBe("created");
    expect(theirs.outcome).toBe("created");
    expect(mine.logId).not.toBe(theirs.logId);
  });
});

describe("status transitions", () => {
  it("records queued → sending → sent", async () => {
    const { logId } = await createQueuedLog(logInput());

    await markSending(logId);
    let [row] = await getDb()
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.id, logId));
    expect(row?.status).toBe("sending");

    await markSent(logId, { messageId: "ses-msg-1", sesRequestId: "ses-req-1" });
    [row] = await getDb()
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.id, logId));

    expect(row?.status).toBe("sent");
    expect(row?.messageId).toBe("ses-msg-1");
    expect(row?.sesRequestId).toBe("ses-req-1");
    expect(row?.sentAt).toBeInstanceOf(Date);
    // SNS delivery events complete the lifecycle in a later phase.
    expect(row?.completedAt).toBeNull();
  });

  it("records a terminal failure with its provider detail", async () => {
    const { logId } = await createQueuedLog(logInput());

    await markFailed(logId, {
      errorCode: "MessageRejected",
      errorMessage: "Email address is not verified",
      sesRequestId: "ses-req-2",
      retryable: false,
    });

    const [row] = await getDb()
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.id, logId));

    expect(row?.status).toBe("failed");
    expect(row?.errorCode).toBe("MessageRejected");
    expect(row?.errorMessage).toBe("Email address is not verified");
    expect(row?.providerEvent).toEqual({ retryable: false });
    expect(row?.completedAt).toBeInstanceOf(Date);
  });

  // error_code is varchar(120); an over-long provider name must not blow up
  // the update.
  it("truncates an over-long provider error code", async () => {
    const { logId } = await createQueuedLog(logInput());

    await markFailed(logId, {
      errorCode: "E".repeat(300),
      errorMessage: "long",
      sesRequestId: null,
      retryable: true,
    });

    const [row] = await getDb()
      .select()
      .from(emailLogs)
      .where(eq(emailLogs.id, logId));

    expect(row?.errorCode).toHaveLength(120);
  });
});

describe("listRecentActivity", () => {
  it("returns newest first", async () => {
    const first = await createQueuedLog(logInput({ subject: "first" }));
    await new Promise((r) => setTimeout(r, 5));
    const second = await createQueuedLog(logInput({ subject: "second" }));

    const rows = await listRecentActivity(userId);
    expect(rows.map((r) => r.id)).toEqual([second.logId, first.logId]);
  });

  it("honours the limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await createQueuedLog(logInput({ subject: `s${i}` }));
    }
    expect(await listRecentActivity(userId, 3)).toHaveLength(3);
  });

  it("shows only the caller's own activity", async () => {
    await createQueuedLog(logInput({ subject: "mine" }));
    await createQueuedLog(logInput({ userId: otherUserId, subject: "theirs" }));

    const rows = await listRecentActivity(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe("mine");
  });
});
