import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { emailLogs, snsEvents, snsTopics, type SnsTopic } from "@/db/schema";
import { applyEventToLog } from "@/lib/ses/delivery-state";
import {
  eventTypeName,
  parseSesNotification,
  redactEvent,
  restoreEvent,
  type SesEvent,
} from "@/lib/ses/notification";
import { suppressionsFor } from "@/lib/ses/suppression-policy";
import type { SnsEnvelope } from "@/lib/sns/message";

import { upsertSuppressions, type Executor } from "./suppression";

/**
 * SNS event processing — SRS FR-5, §7 steps 3–7, §11.
 *
 * Everything one SNS message causes happens in **one transaction**: the event
 * row, the log status change, and the suppression upsert. Two consequences:
 *
 *   - **Idempotency.** The event insert is keyed on the SNS MessageId. A
 *     redelivery conflicts, and the function returns before touching anything
 *     else. Because the insert is inside the same transaction as the effects,
 *     "recorded" and "applied" cannot disagree.
 *   - **Durable 2xx.** If any step fails, the whole transaction rolls back, the
 *     webhook answers 5xx, and SNS redelivers. There is no state in which the
 *     event is marked seen but its effects were lost.
 */
type Db = ReturnType<typeof getDb>;

/**
 * Serialises work on one SES message id.
 *
 * An SNS event can arrive in the milliseconds between SES accepting a message
 * and the worker recording its message id. The webhook then finds no log row
 * and stores the event unmatched; the worker, right after recording the id,
 * applies any unmatched events (`reconcileEventsForLog`).
 *
 * Without a lock, one interleaving loses the event: the webhook looks up the
 * log before the worker's write commits, and commits its unmatched event after
 * the worker's reconcile has already looked. Taking the same transaction-scoped
 * advisory lock on the message id in both paths makes them run one after the
 * other, so one of the two always sees the other's write.
 */
async function lockSesMessage(tx: Executor, sesMessageId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${sesMessageId}, 0))`,
  );
}

type LockedLog = {
  id: string;
  status: typeof emailLogs.$inferSelect.status;
  recipients: unknown;
  providerEvent: unknown;
  completedAt: Date | null;
};

async function applyToLog(
  tx: Executor,
  log: LockedLog,
  event: SesEvent,
  snsMessageId: string,
): Promise<boolean> {
  const update = applyEventToLog(
    {
      status: log.status,
      recipients: Array.isArray(log.recipients)
        ? (log.recipients as string[])
        : [],
      providerEvent: log.providerEvent,
    },
    event,
    snsMessageId,
  );
  if (!update) return false;

  await tx
    .update(emailLogs)
    .set({
      status: update.status,
      providerEvent: update.providerEvent,
      completedAt: update.complete ? (log.completedAt ?? new Date()) : null,
    })
    .where(eq(emailLogs.id, log.id));

  return true;
}

async function lockLog(
  tx: Executor,
  userId: string,
  sesMessageId: string,
): Promise<LockedLog | null> {
  const [row] = await tx
    .select({
      id: emailLogs.id,
      status: emailLogs.status,
      recipients: emailLogs.recipients,
      providerEvent: emailLogs.providerEvent,
      completedAt: emailLogs.completedAt,
    })
    .from(emailLogs)
    // userId comes from the registered topic, never from the payload: an
    // event can only ever touch its own tenant's logs, even if two tenants'
    // SES message ids were somehow to collide.
    .where(
      and(eq(emailLogs.userId, userId), eq(emailLogs.messageId, sesMessageId)),
    )
    .limit(1)
    .for("update");
  return row ?? null;
}

export type NotificationOutcome =
  | { outcome: "duplicate" }
  | {
      outcome: "processed";
      eventType: string | null;
      matchedLogId: string | null;
      statusChanged: boolean;
      suppressed: number;
    };

export async function processNotification(
  topic: Pick<SnsTopic, "userId" | "topicArn">,
  envelope: Extract<SnsEnvelope, { Type: "Notification" }>,
): Promise<NotificationOutcome> {
  const event = parseSesNotification(envelope.Message);
  const db: Db = getDb();

  return db.transaction(async (tx) => {
    if (event?.sesMessageId) await lockSesMessage(tx, event.sesMessageId);

    const [inserted] = await tx
      .insert(snsEvents)
      .values({
        messageId: envelope.MessageId,
        userId: topic.userId,
        topicArn: topic.topicArn,
        messageType: envelope.Type,
        eventType: event ? eventTypeName(event).slice(0, 40) : null,
        sesMessageId: event?.sesMessageId ?? null,
        eventAt: event?.at ?? null,
        payload: event ? redactEvent(event) : null,
      })
      .onConflictDoNothing({ target: snsEvents.messageId })
      .returning({ id: snsEvents.id });

    // SRS §7 step 3: the SNS MessageId is the idempotency key.
    if (!inserted) return { outcome: "duplicate" } as const;

    await tx
      .update(snsTopics)
      .set({ lastMessageAt: new Date() })
      .where(eq(snsTopics.topicArn, topic.topicArn));

    if (!event || event.kind === "other") {
      return {
        outcome: "processed",
        eventType: event ? eventTypeName(event) : null,
        matchedLogId: null,
        statusChanged: false,
        suppressed: 0,
      } as const;
    }

    const log = await lockLog(tx, topic.userId, event.sesMessageId);
    let statusChanged = false;

    if (log) {
      statusChanged = await applyToLog(tx, log, event, envelope.MessageId);
      await tx
        .update(snsEvents)
        .set({ logId: log.id })
        .where(eq(snsEvents.id, inserted.id));
    }

    // Suppression does not depend on finding the log. A hard bounce for mail
    // this tenant sent through the same SES identity by some other route is
    // still a hard bounce.
    const suppressed = await upsertSuppressions(
      tx,
      topic.userId,
      suppressionsFor(event),
      envelope.MessageId,
    );

    return {
      outcome: "processed",
      eventType: eventTypeName(event),
      matchedLogId: log?.id ?? null,
      statusChanged,
      suppressed,
    } as const;
  });
}

/**
 * Applies events that arrived before the worker recorded the SES message id.
 * Called by the worker immediately after `markSent`. Returns how many applied.
 */
export async function reconcileEventsForLog(
  userId: string,
  sesMessageId: string,
): Promise<number> {
  const db: Db = getDb();

  return db.transaction(async (tx) => {
    await lockSesMessage(tx, sesMessageId);

    const pending = await tx
      .select()
      .from(snsEvents)
      .where(
        and(
          eq(snsEvents.userId, userId),
          eq(snsEvents.sesMessageId, sesMessageId),
          isNull(snsEvents.logId),
        ),
      )
      .orderBy(asc(snsEvents.receivedAt));

    if (pending.length === 0) return 0;

    const log = await lockLog(tx, userId, sesMessageId);
    if (!log) return 0;

    let applied = 0;
    for (const stored of pending) {
      const event = restoreEvent(stored);
      if (!event) continue;

      if (await applyToLog(tx, log, event, stored.messageId)) {
        applied += 1;
        // Re-read so the next event builds on this one's result.
        const fresh = await lockLog(tx, userId, sesMessageId);
        if (fresh) Object.assign(log, fresh);
      }

      await tx
        .update(snsEvents)
        .set({ logId: log.id })
        .where(eq(snsEvents.id, stored.id));
    }

    return applied;
  });
}

/**
 * Records a subscription lifecycle message and moves the topic's state.
 * Returns false if this SNS message was already processed.
 */
export async function recordSubscriptionMessage(
  topic: Pick<SnsTopic, "userId" | "topicArn">,
  envelope: Extract<
    SnsEnvelope,
    { Type: "SubscriptionConfirmation" | "UnsubscribeConfirmation" }
  >,
  subscriptionArn: string | null,
): Promise<boolean> {
  const db: Db = getDb();

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(snsEvents)
      .values({
        messageId: envelope.MessageId,
        userId: topic.userId,
        topicArn: topic.topicArn,
        messageType: envelope.Type,
      })
      .onConflictDoNothing({ target: snsEvents.messageId })
      .returning({ id: snsEvents.id });

    if (!inserted) return false;

    const now = new Date();
    await tx
      .update(snsTopics)
      .set(
        envelope.Type === "SubscriptionConfirmation"
          ? {
              status: "confirmed",
              confirmedAt: now,
              lastMessageAt: now,
              ...(subscriptionArn ? { subscriptionArn } : {}),
            }
          : { status: "unsubscribed", lastMessageAt: now },
      )
      .where(eq(snsTopics.topicArn, topic.topicArn));

    return true;
  });
}

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

export async function listRecentEvents(userId: string, limit = 25) {
  return getDb()
    .select({
      id: snsEvents.id,
      messageType: snsEvents.messageType,
      eventType: snsEvents.eventType,
      sesMessageId: snsEvents.sesMessageId,
      logId: snsEvents.logId,
      eventAt: snsEvents.eventAt,
      receivedAt: snsEvents.receivedAt,
    })
    .from(snsEvents)
    .where(eq(snsEvents.userId, userId))
    .orderBy(desc(snsEvents.receivedAt))
    .limit(limit);
}

export interface WebhookStats {
  lastReceivedAt: Date | null;
  last24h: number;
  unmatched24h: number;
  /** Median of `received_at − event_at` over the last 24h, in ms. */
  medianLagMs: number | null;
  maxLagMs: number | null;
}

/** SRS §12 System Health: "webhook lag". Tenant-scoped. */
export async function webhookStats(userId: string): Promise<WebhookStats> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  const [row] = await getDb()
    .select({
      lastReceivedAt: sql<string | null>`max(${snsEvents.receivedAt})`,
      last24h: sql<number>`count(*) filter (where ${snsEvents.receivedAt} >= ${since.toISOString()})`,
      unmatched24h: sql<number>`count(*) filter (where ${snsEvents.receivedAt} >= ${since.toISOString()} and ${snsEvents.sesMessageId} is not null and ${snsEvents.logId} is null)`,
      medianLagMs: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${snsEvents.receivedAt} - ${snsEvents.eventAt})) * 1000) filter (where ${snsEvents.eventAt} is not null and ${snsEvents.receivedAt} >= ${since.toISOString()})`,
      maxLagMs: sql<number | null>`max(extract(epoch from (${snsEvents.receivedAt} - ${snsEvents.eventAt})) * 1000) filter (where ${snsEvents.eventAt} is not null and ${snsEvents.receivedAt} >= ${since.toISOString()})`,
    })
    .from(snsEvents)
    .where(eq(snsEvents.userId, userId));

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return {
    lastReceivedAt: row?.lastReceivedAt ? new Date(row.lastReceivedAt) : null,
    last24h: Number(row?.last24h ?? 0),
    unmatched24h: Number(row?.unmatched24h ?? 0),
    medianLagMs: num(row?.medianLagMs),
    maxLagMs: num(row?.maxLagMs),
  };
}
