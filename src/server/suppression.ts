import "server-only";

import { and, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  auditLogs,
  suppressionList,
  type AuditLog,
  type Suppression,
} from "@/db/schema";
import { normaliseAddress } from "@/lib/ses/notification";
import type { SuppressionDecision } from "@/lib/ses/suppression-policy";

/**
 * Suppression list — SRS FR-5 steps 6–7, §11.
 *
 * Scoped per tenant, not per environment: an address that hard-bounced from
 * staging does not exist in production either, and a recipient who complained
 * did not complain about an environment.
 *
 * Addresses are stored and compared lowercased. Mailbox local parts are
 * technically case-sensitive, but no mainstream provider treats them that way,
 * and a case-sensitive list would let `Bob@x.com` through after `bob@x.com`
 * bounced.
 */
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

/**
 * Returns the subset of `emails` that is actively suppressed for the tenant.
 * One indexed query regardless of recipient count.
 */
export async function findSuppressed(
  userId: string,
  emails: readonly string[],
): Promise<string[]> {
  if (emails.length === 0) return [];

  const wanted = [...new Set(emails.map(normaliseAddress))];
  const rows = await getDb()
    .select({ email: suppressionList.email })
    .from(suppressionList)
    .where(
      and(
        eq(suppressionList.userId, userId),
        eq(suppressionList.active, true),
        inArray(suppressionList.email, wanted),
      ),
    );

  return rows.map((r) => r.email);
}

/**
 * Adds addresses to the list, inside the caller's transaction.
 *
 * An address that is already actively suppressed keeps its original reason and
 * source event: the first hard bounce is the useful record, not the tenth. An
 * address that was suppressed and later deactivated is re-activated with the
 * new reason, because a fresh hard bounce or complaint is new evidence.
 */
export async function upsertSuppressions(
  executor: Executor,
  userId: string,
  decisions: readonly SuppressionDecision[],
  sourceEventId: string,
): Promise<number> {
  if (decisions.length === 0) return 0;

  const byEmail = new Map<string, SuppressionDecision>();
  for (const d of decisions) byEmail.set(normaliseAddress(d.email), d);

  const rows = await executor
    .insert(suppressionList)
    .values(
      [...byEmail.entries()].map(([email, d]) => ({
        userId,
        email: email.slice(0, 320),
        reason: d.reason,
        sourceEventId,
        active: true,
      })),
    )
    .onConflictDoUpdate({
      target: [suppressionList.userId, suppressionList.email],
      set: {
        active: true,
        reason: sql`excluded.reason`,
        sourceEventId: sql`excluded.source_event_id`,
      },
      setWhere: eq(suppressionList.active, false),
    })
    .returning({ id: suppressionList.id });

  return rows.length;
}

export interface SuppressionQuery {
  search?: string | undefined;
  includeInactive?: boolean | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface SuppressionPage {
  rows: Suppression[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listSuppressions(
  userId: string,
  {
    search,
    includeInactive = false,
    page = 1,
    pageSize = 25,
  }: SuppressionQuery = {},
): Promise<SuppressionPage> {
  const filters = [eq(suppressionList.userId, userId)];
  if (!includeInactive) filters.push(eq(suppressionList.active, true));

  const term = search?.trim();
  if (term) {
    // Escape LIKE metacharacters so a search for `a_b` is literal.
    const escaped = term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
    filters.push(ilike(suppressionList.email, `%${escaped}%`));
  }

  const where = and(...filters);
  const db = getDb();
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(suppressionList)
      .where(where)
      .orderBy(desc(suppressionList.createdAt), desc(suppressionList.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(suppressionList).where(where),
  ]);

  const total = Number(totals?.n ?? 0);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

// ---------------------------------------------------------------------------
// Manual management — SRS §11: "Manual unsuppression, if implemented, must be
// explicit and auditable."
//
// Explicit: each change names one address and requires a stated reason.
// Auditable: the audit row is written in the same transaction as the change,
// so there is no state in which the list changed and the record of who changed
// it, when and why, did not.
// ---------------------------------------------------------------------------

export class SuppressionChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuppressionChangeError";
  }
}

export interface ManualChange {
  userId: string;
  /** The signed-in user's email. */
  actor: string;
  email: string;
  note: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addSuppression(change: ManualChange): Promise<Suppression> {
  const email = normaliseAddress(change.email);
  if (!EMAIL.test(email) || email.length > 320) {
    throw new SuppressionChangeError("Enter a single valid email address.");
  }

  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(suppressionList)
      .where(and(eq(suppressionList.userId, change.userId), eq(suppressionList.email, email)))
      .limit(1)
      .for("update");

    if (existing?.active) {
      throw new SuppressionChangeError(`${email} is already suppressed.`);
    }

    const [row] = existing
      ? await tx
          .update(suppressionList)
          .set({ active: true, reason: "manual", sourceEventId: null })
          .where(eq(suppressionList.id, existing.id))
          .returning()
      : await tx
          .insert(suppressionList)
          .values({ userId: change.userId, email, reason: "manual", active: true })
          .returning();
    if (!row) throw new Error("Failed to write suppression");

    await tx.insert(auditLogs).values({
      userId: change.userId,
      actor: change.actor,
      action: "suppression.add",
      target: email,
      detail: { note: change.note, previous: existing ? { reason: existing.reason, active: false } : null },
    });

    return row;
  });
}

/**
 * Deactivates rather than deletes: the row keeps the original reason and
 * source event, so a later look at the address still shows why it was ever
 * suppressed. A fresh hard bounce or complaint re-activates it automatically.
 */
export async function removeSuppression(change: ManualChange): Promise<Suppression> {
  const email = normaliseAddress(change.email);

  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(suppressionList)
      .where(and(eq(suppressionList.userId, change.userId), eq(suppressionList.email, email)))
      .limit(1)
      .for("update");

    if (!existing?.active) {
      throw new SuppressionChangeError(`${email} is not currently suppressed.`);
    }

    const [row] = await tx
      .update(suppressionList)
      .set({ active: false })
      .where(eq(suppressionList.id, existing.id))
      .returning();
    if (!row) throw new Error("Failed to update suppression");

    await tx.insert(auditLogs).values({
      userId: change.userId,
      actor: change.actor,
      action: "suppression.remove",
      target: email,
      detail: {
        note: change.note,
        previous: { reason: existing.reason, sourceEventId: existing.sourceEventId },
      },
    });

    return row;
  });
}

export async function listSuppressionAudit(
  userId: string,
  limit = 20,
): Promise<AuditLog[]> {
  return getDb()
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.userId, userId), sql`${auditLogs.action} like 'suppression.%'`))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
