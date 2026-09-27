import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { emailLogs, type Environment, type EmailStatus } from "@/db/schema";

/**
 * Email activity log — SRS FR-7 (basic logging for Phase 1).
 *
 * The log row is created before any provider call and is the durable record of
 * acceptance: the API's 202 means "this row exists", per SRS §8 step 4.
 */
export interface CreateLogInput {
  userId: string;
  environment: Environment;
  fromAddress: string;
  recipients: string[];
  subject: string;
  idempotencyKey: string | null;
  tags: Record<string, string> | null;
  /** Set for templated sends: exactly which template version was rendered. */
  templateId?: string | null | undefined;
  templateVersion?: number | null | undefined;
}

export type CreateLogResult =
  | { outcome: "created"; logId: string }
  /** An earlier request used the same idempotency key for this tenant. */
  | { outcome: "duplicate"; logId: string; status: EmailStatus };

/**
 * Inserts a `queued` log, honouring the `email_logs_user_idempotency` unique
 * index.
 *
 * The uniqueness decision is delegated to PostgreSQL rather than a
 * read-then-write check, so two concurrent requests carrying the same
 * idempotency key cannot both be accepted.
 */
export async function createQueuedLog(
  input: CreateLogInput,
): Promise<CreateLogResult> {
  const db = getDb();

  const inserted = await db
    .insert(emailLogs)
    .values({
      userId: input.userId,
      environment: input.environment,
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      fromAddress: input.fromAddress,
      recipients: input.recipients,
      subject: input.subject,
      tags: input.tags,
      templateId: input.templateId ?? null,
      templateVersion: input.templateVersion ?? null,
    })
    .onConflictDoNothing({
      target: [emailLogs.userId, emailLogs.idempotencyKey],
    })
    .returning({ id: emailLogs.id });

  const row = inserted[0];
  if (row) return { outcome: "created", logId: row.id };

  // Conflict: an insert with no returned row means the unique index rejected
  // it. Only reachable when an idempotency key was supplied, because NULLs do
  // not collide in a PostgreSQL unique index.
  if (input.idempotencyKey === null) {
    throw new Error("Email log insert returned no row");
  }

  const [existing] = await db
    .select({ id: emailLogs.id, status: emailLogs.status })
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.userId, input.userId),
        eq(emailLogs.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error("Idempotency conflict without a matching prior record");
  }

  return {
    outcome: "duplicate",
    logId: existing.id,
    status: existing.status,
  };
}

export async function markSending(logId: string): Promise<void> {
  const db = getDb();
  await db
    .update(emailLogs)
    .set({ status: "sending" })
    .where(eq(emailLogs.id, logId));
}

export interface SentDetails {
  messageId: string | null;
  sesRequestId: string | null;
}

export async function markSent(
  logId: string,
  details: SentDetails,
): Promise<void> {
  const now = new Date();
  const db = getDb();

  await db
    .update(emailLogs)
    .set({
      status: "sent",
      messageId: details.messageId,
      sesRequestId: details.sesRequestId,
      sentAt: now,
      // `completedAt` stays null: SNS delivery, bounce and complaint events
      // close the lifecycle (src/server/sns-events.ts).
    })
    .where(eq(emailLogs.id, logId));
}

/**
 * Records a failed attempt that will be retried.
 *
 * The row goes back to `queued` rather than `failed`: the message is still
 * live, and showing it as failed while the queue is about to retry it would
 * misreport the system's actual state. The error fields keep the most recent
 * cause visible, and `completedAt` stays null because the lifecycle is open.
 */
export interface RetryDetails {
  errorCode: string;
  errorMessage: string;
  sesRequestId: string | null;
  attempt: number;
  nextAttemptAt: Date | null;
}

export async function markRetrying(
  logId: string,
  details: RetryDetails,
): Promise<void> {
  const db = getDb();

  await db
    .update(emailLogs)
    .set({
      status: "queued",
      errorCode: details.errorCode.slice(0, 120),
      errorMessage: details.errorMessage,
      sesRequestId: details.sesRequestId,
      providerEvent: {
        retryable: true,
        attempt: details.attempt,
        nextAttemptAt: details.nextAttemptAt?.toISOString() ?? null,
      },
      completedAt: null,
    })
    .where(eq(emailLogs.id, logId));
}

export interface FailureDetails {
  errorCode: string;
  errorMessage: string;
  sesRequestId: string | null;
  retryable: boolean;
  /** Why the message stopped: exhausted retries, or a permanent rejection. */
  terminalReason?: "attempts_exhausted" | "permanent" | "no_credential" | undefined;
  attempt?: number | undefined;
}

export async function markFailed(
  logId: string,
  details: FailureDetails,
): Promise<void> {
  const db = getDb();

  await db
    .update(emailLogs)
    .set({
      status: "failed",
      errorCode: details.errorCode.slice(0, 120),
      errorMessage: details.errorMessage,
      sesRequestId: details.sesRequestId,
      // The dead-letter record. The BullMQ failed set holds the job itself;
      // this is the tenant-visible half of the same event.
      providerEvent: {
        retryable: details.retryable,
        ...(details.terminalReason
          ? { terminalReason: details.terminalReason }
          : {}),
        ...(details.attempt === undefined ? {} : { attempt: details.attempt }),
      },
      completedAt: new Date(),
    })
    .where(eq(emailLogs.id, logId));
}

/**
 * Closes out a message the worker refused to submit because a recipient was
 * suppressed after the API accepted it (SRS §11: suppression is checked again
 * "immediately before provider submission").
 *
 * This is not a failure — nothing went wrong, the system did what it should —
 * so it gets its own terminal status rather than `failed`.
 */
export async function markSuppressed(
  logId: string,
  suppressed: string[],
): Promise<void> {
  const db = getDb();

  await db
    .update(emailLogs)
    .set({
      status: "suppressed",
      errorCode: "RECIPIENT_SUPPRESSED",
      errorMessage: `Not sent: ${suppressed.length} recipient(s) are on the suppression list.`,
      providerEvent: { suppressed },
      completedAt: new Date(),
    })
    .where(eq(emailLogs.id, logId));
}

export interface ActivityRow {
  id: string;
  environment: Environment;
  status: EmailStatus;
  fromAddress: string;
  recipients: string[];
  subject: string;
  messageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: Date;
  sentAt: Date | null;
}

/** Recent activity for the dashboard, always scoped to one tenant. */
export async function listRecentActivity(
  userId: string,
  limit = 50,
): Promise<ActivityRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.userId, userId))
    .orderBy(desc(emailLogs.queuedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    environment: row.environment,
    status: row.status,
    fromAddress: row.fromAddress,
    recipients: Array.isArray(row.recipients)
      ? (row.recipients as string[])
      : [],
    subject: row.subject,
    messageId: row.messageId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    queuedAt: row.queuedAt,
    sentAt: row.sentAt,
  }));
}
