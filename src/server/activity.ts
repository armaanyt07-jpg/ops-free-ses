import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb } from "@/db";
import {
  emailLogs,
  snsEvents,
  type EmailLog,
  type Environment,
  type SnsEvent,
} from "@/db/schema";
import {
  likePattern,
  PAGE_SIZE,
  UUID,
  type ActivityFilters,
  type WindowDays,
} from "@/lib/dashboard/params";

/**
 * Dashboard reads over `email_logs` — Phase 4 activity explorer, message
 * detail, delivery statistics and error tracking (SRS §12).
 *
 * Every function takes the tenant and environment explicitly and puts both in
 * its WHERE clause. They are served by `email_logs_user_env_queued`.
 */
function scope(userId: string, environment: Environment): SQL[] {
  return [eq(emailLogs.userId, userId), eq(emailLogs.environment, environment)];
}

// ---------------------------------------------------------------------------
// Activity explorer
// ---------------------------------------------------------------------------

export interface ActivityPage {
  rows: EmailLog[];
  total: number;
  page: number;
  pageCount: number;
}

function filterConditions(filters: ActivityFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.status) conditions.push(eq(emailLogs.status, filters.status));
  if (filters.errorCode) conditions.push(eq(emailLogs.errorCode, filters.errorCode));
  if (filters.templateId) conditions.push(eq(emailLogs.templateId, filters.templateId));
  if (filters.from) conditions.push(gte(emailLogs.queuedAt, filters.from));
  if (filters.to) conditions.push(lte(emailLogs.queuedAt, filters.to));

  const q = filters.q;
  if (q) {
    const pattern = likePattern(q);
    // SRS §12: "Search by recipient, message ID, subject, … status, date".
    const matches: SQL[] = [
      ilike(emailLogs.subject, pattern),
      ilike(emailLogs.fromAddress, pattern),
      ilike(emailLogs.messageId, pattern),
      sql`${emailLogs.recipients}::text ilike ${pattern}`,
    ];
    // A pasted log id (from an API response or a webhook) finds its message.
    if (UUID.test(q)) matches.push(eq(emailLogs.id, q.toLowerCase()));
    conditions.push(or(...matches)!);
  }

  return conditions;
}

export async function searchActivity(
  userId: string,
  environment: Environment,
  filters: ActivityFilters,
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<ActivityPage> {
  const where = and(...scope(userId, environment), ...filterConditions(filters));
  const db = getDb();

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(emailLogs)
      .where(where)
      .orderBy(desc(emailLogs.queuedAt), desc(emailLogs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(emailLogs).where(where),
  ]);

  const total = Number(totals?.n ?? 0);
  return {
    rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ---------------------------------------------------------------------------
// Message detail
// ---------------------------------------------------------------------------

export interface MessageDetail {
  log: EmailLog;
  events: SnsEvent[];
}

/**
 * One message and every SNS event matched to it. Not environment-scoped: a
 * message id is unambiguous, and a link to a staging message should open even
 * while the switcher says production. It is still tenant-scoped.
 */
export async function getMessageDetail(
  userId: string,
  logId: string,
): Promise<MessageDetail | null> {
  if (!UUID.test(logId)) return null;
  const db = getDb();

  const [log] = await db
    .select()
    .from(emailLogs)
    .where(and(eq(emailLogs.id, logId), eq(emailLogs.userId, userId)))
    .limit(1);
  if (!log) return null;

  const events = await db
    .select()
    .from(snsEvents)
    .where(and(eq(snsEvents.userId, userId), eq(snsEvents.logId, log.id)))
    .orderBy(asc(snsEvents.eventAt), asc(snsEvents.receivedAt));

  return { log, events };
}

// ---------------------------------------------------------------------------
// Delivery statistics
// ---------------------------------------------------------------------------

export interface DeliveryStats {
  days: WindowDays;
  total: number;
  inFlight: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  suppressed: number;
  /** Messages SES accepted: sent + delivered + bounced + complained. */
  reachedSes: number;
  /** Messages SES has reported an outcome for. */
  withOutcome: number;
  /** delivered (incl. complained) / withOutcome; null without outcome data. */
  deliveryRate: number | null;
  /** bounced / reachedSes, as SES computes it; null when nothing was sent. */
  bounceRate: number | null;
  complaintRate: number | null;
}

export function since(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 3600 * 1000);
}

const byStatus = (status: string) =>
  sql<number>`count(*) filter (where ${emailLogs.status} = ${status})`;

export async function deliveryStats(
  userId: string,
  environment: Environment,
  days: WindowDays,
): Promise<DeliveryStats> {
  const [row] = await getDb()
    .select({
      total: count(),
      queued: byStatus("queued"),
      sending: byStatus("sending"),
      sent: byStatus("sent"),
      delivered: byStatus("delivered"),
      bounced: byStatus("bounced"),
      complained: byStatus("complained"),
      failed: byStatus("failed"),
      suppressed: byStatus("suppressed"),
    })
    .from(emailLogs)
    .where(and(...scope(userId, environment), gte(emailLogs.queuedAt, since(days))));

  return summarise(days, row);
}

/** Exported for unit tests: the arithmetic, separate from the query. */
export function summarise(
  days: WindowDays,
  row: Partial<Record<string, number | string>> | undefined,
): DeliveryStats {
  const n = (k: string) => Number(row?.[k] ?? 0);
  const delivered = n("delivered");
  const bounced = n("bounced");
  const complained = n("complained");
  const sent = n("sent");

  const reachedSes = sent + delivered + bounced + complained;
  const withOutcome = delivered + bounced + complained;
  const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

  return {
    days,
    total: n("total"),
    inFlight: n("queued") + n("sending"),
    sent,
    delivered,
    bounced,
    complained,
    failed: n("failed"),
    suppressed: n("suppressed"),
    reachedSes,
    withOutcome,
    // A complaint is about a message that was delivered.
    deliveryRate: ratio(delivered + complained, withOutcome),
    bounceRate: ratio(bounced, reachedSes),
    complaintRate: ratio(complained, reachedSes),
  };
}

export interface VolumeBucket {
  start: Date;
  delivered: number;
  /** Accepted, no final outcome yet: queued, sending, or sent. */
  pending: number;
  /** Bounced or complained. */
  problems: number;
  /** Failed or suppressed: never reached a mailbox. */
  notSent: number;
}

/**
 * Per-bucket volume for the overview chart: hourly for the 1-day window,
 * daily otherwise, in UTC. Every bucket is present, including empty ones, so
 * the chart's x-axis is continuous.
 */
export async function volumeSeries(
  userId: string,
  environment: Environment,
  days: WindowDays,
): Promise<VolumeBucket[]> {
  const unit = days === 1 ? "hour" : "day";
  const buckets = days === 1 ? 24 : days;
  const u = sql.raw(`'${unit}'`);
  const step = sql.raw(`interval '1 ${unit}'`);

  const result = await getDb().execute(sql`
    with buckets as (
      select generate_series(
        date_trunc(${u}, now(), 'UTC') - (${buckets - 1} * ${step}),
        date_trunc(${u}, now(), 'UTC'),
        ${step}
      ) as start
    )
    select
      b.start,
      count(l.id) filter (where l.status = 'delivered')                          as delivered,
      count(l.id) filter (where l.status in ('queued', 'sending', 'sent'))       as pending,
      count(l.id) filter (where l.status in ('bounced', 'complained'))           as problems,
      count(l.id) filter (where l.status in ('failed', 'suppressed'))            as not_sent
    from buckets b
    left join email_logs l
      on l.user_id = ${userId}
     and l.environment = ${environment}
     and l.queued_at >= b.start
     and l.queued_at <  b.start + ${step}
    group by b.start
    order by b.start
  `);

  const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    start: new Date(r.start as string),
    delivered: Number(r.delivered),
    pending: Number(r.pending),
    problems: Number(r.problems),
    notSent: Number(r.not_sent),
  }));
}

// ---------------------------------------------------------------------------
// Error tracking
// ---------------------------------------------------------------------------

export interface ErrorGroup {
  errorCode: string;
  count: number;
  lastSeen: Date;
  sampleMessage: string | null;
  sampleLogId: string;
}

/** Failed and suppressed messages grouped by cause, most frequent first. */
export async function errorGroups(
  userId: string,
  environment: Environment,
  days: WindowDays,
): Promise<ErrorGroup[]> {
  const rows = await getDb()
    .select({
      errorCode: emailLogs.errorCode,
      count: count(),
      lastSeen: sql<string>`max(${emailLogs.queuedAt})`,
      sampleMessage: sql<string | null>`(array_agg(${emailLogs.errorMessage} order by ${emailLogs.queuedAt} desc))[1]`,
      sampleLogId: sql<string>`(array_agg(${emailLogs.id} order by ${emailLogs.queuedAt} desc))[1]`,
    })
    .from(emailLogs)
    .where(
      and(
        ...scope(userId, environment),
        gte(emailLogs.queuedAt, since(days)),
        sql`${emailLogs.status} in ('failed', 'suppressed')`,
        sql`${emailLogs.errorCode} is not null`,
      ),
    )
    .groupBy(emailLogs.errorCode)
    .orderBy(desc(count()));

  return rows.map((r) => ({
    errorCode: r.errorCode ?? "UNKNOWN",
    count: Number(r.count),
    lastSeen: new Date(r.lastSeen),
    sampleMessage: r.sampleMessage,
    sampleLogId: String(r.sampleLogId),
  }));
}

export interface BounceGroup {
  eventType: string;
  kind: string;
  subType: string | null;
  count: number;
}

/**
 * Bounces and complaints by type, from the SNS events matched to this
 * environment's messages. Transient vs permanent matters for troubleshooting:
 * one is a full mailbox, the other a list-hygiene problem.
 */
export async function bounceGroups(
  userId: string,
  environment: Environment,
  days: WindowDays,
): Promise<BounceGroup[]> {
  const kind = sql<string>`coalesce(${snsEvents.payload}->>'bounceType', ${snsEvents.payload}->>'feedbackType', 'unspecified')`;
  const subType = sql<string | null>`${snsEvents.payload}->>'bounceSubType'`;

  const rows = await getDb()
    .select({
      eventType: snsEvents.eventType,
      kind,
      subType,
      count: count(),
    })
    .from(snsEvents)
    .innerJoin(emailLogs, eq(emailLogs.id, snsEvents.logId))
    .where(
      and(
        eq(snsEvents.userId, userId),
        eq(emailLogs.environment, environment),
        gte(snsEvents.receivedAt, since(days)),
        sql`${snsEvents.eventType} in ('Bounce', 'Complaint')`,
      ),
    )
    .groupBy(snsEvents.eventType, kind, subType)
    .orderBy(desc(count()));

  return rows.map((r) => ({
    eventType: r.eventType ?? "",
    kind: r.kind,
    subType: r.subType,
    count: Number(r.count),
  }));
}
