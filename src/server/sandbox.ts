import "server-only";

import { createHash } from "node:crypto";

import { and, eq, gte, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { sandboxRequests, snsEvents, type Environment, type SandboxRequest } from "@/db/schema";
import {
  draftSchema,
  generateRequest,
  missingAnswers,
  reviewableText,
  USE_CASE_MAX,
  type Draft,
  type GeneratedRequest,
  type PlatformFacts,
} from "@/lib/sandbox/request";

import { deliveryStats } from "./activity";
import { listDomains } from "./domains";
import { listEmailIdentities } from "./email-identities";
import { listTopics } from "./sns-topics";

/**
 * Sandbox-exit assistant — SRS §13, Phase 6.
 *
 * Holds the draft, gathers the platform facts the user may choose to cite,
 * and records the human review. The review is bound to a SHA-256 of the exact
 * generated text: if an answer changes, or a platform fact changes underneath
 * (a domain re-checked, new metrics), the text changes, the hash no longer
 * matches, and the request is no longer "reviewed". Nobody can end up copying
 * text they did not read.
 *
 * Nothing here contacts AWS or submits anything.
 */

const FACT_WINDOW_DAYS = 30;

/**
 * Facts are only offered when they are demonstrably true right now.
 *
 * `autoSuppressionActive` requires a confirmed SNS topic *and* SES events
 * actually received in the window. A confirmed subscription alone does not
 * prove SES is publishing to it — the identity's notification settings could
 * point elsewhere — and a claim of automatic suppression must not rest on that.
 */
export async function collectFacts(userId: string, environment: Environment): Promise<PlatformFacts> {
  const since = new Date(Date.now() - FACT_WINDOW_DAYS * 24 * 3600 * 1000);

  const [domains, topics, events, stats, addresses] = await Promise.all([
    listDomains(userId),
    listTopics(userId),
    getDb()
      .select({ id: snsEvents.id })
      .from(snsEvents)
      .where(
        and(
          eq(snsEvents.userId, userId),
          gte(snsEvents.receivedAt, since),
          inArray(snsEvents.eventType, ["Bounce", "Complaint", "Delivery"]),
        ),
      )
      .limit(1),
    deliveryStats(userId, environment, 30),
    listEmailIdentities(userId),
  ]);

  const autoSuppressionActive = topics.some((t) => t.status === "confirmed") && events.length > 0;

  return {
    domains: domains
      .filter((d) => d.environment === environment && d.status === "verified")
      .map((d) => ({
        id: d.id,
        domain: d.domain,
        sesVerified: true,
        dkim: d.check?.dkim.status ?? "unknown",
        spf: d.check?.spf.status ?? "unknown",
        dmarc: d.check?.dmarc.status ?? "unknown",
        dmarcPolicy: d.check?.dmarc.policy ?? null,
        checkedAt: d.lastCheckedAt?.toISOString() ?? null,
      })),
    verifiedAddresses: addresses.filter((a) => a.environment === environment && a.status === "verified").length,
    autoSuppressionActive,
    // Rates without outcome data would read 0% because nothing was measured.
    metrics:
      autoSuppressionActive && stats.withOutcome > 0 && stats.bounceRate !== null && stats.complaintRate !== null
        ? {
            days: FACT_WINDOW_DAYS,
            reachedSes: stats.reachedSes,
            withOutcome: stats.withOutcome,
            bounceRate: stats.bounceRate,
            complaintRate: stats.complaintRate,
            measuredAt: new Date().toISOString(),
          }
        : null,
  };
}

export function hashRequest(req: GeneratedRequest): string {
  return createHash("sha256").update(reviewableText(req)).digest("hex");
}

export function readDraft(row: SandboxRequest | null | undefined): Draft {
  const parsed = draftSchema.safeParse(row?.answers ?? {});
  return parsed.success ? parsed.data : {};
}

export async function getSandboxRequest(userId: string, environment: Environment): Promise<SandboxRequest | null> {
  const [row] = await getDb()
    .select()
    .from(sandboxRequests)
    .where(and(eq(sandboxRequests.userId, userId), eq(sandboxRequests.environment, environment)))
    .limit(1);
  return row ?? null;
}

/**
 * Saves answers. Any change clears the review: the reviewer confirmed the old
 * text, not this one.
 */
export async function saveDraft(userId: string, environment: Environment, draft: Draft): Promise<SandboxRequest> {
  const existing = await getSandboxRequest(userId, environment);
  const changed = JSON.stringify(readDraft(existing)) !== JSON.stringify(draft);

  const [row] = await getDb()
    .insert(sandboxRequests)
    .values({ userId, environment, answers: draft })
    .onConflictDoUpdate({
      target: [sandboxRequests.userId, sandboxRequests.environment],
      set: {
        answers: draft,
        updatedAt: new Date(),
        ...(changed ? { reviewedAt: null, reviewedBy: null, reviewedHash: null } : {}),
      },
    })
    .returning();
  if (!row) throw new Error("Failed to save draft");
  return row;
}

export type BuildResult =
  | { ok: true; request: GeneratedRequest; hash: string }
  | { ok: false; missing: string[]; tooLong?: boolean };

/** Generates from stored answers and *current* facts. */
export async function buildRequest(userId: string, environment: Environment): Promise<BuildResult> {
  const [row, facts] = await Promise.all([
    getSandboxRequest(userId, environment),
    collectFacts(userId, environment),
  ]);
  const draft = readDraft(row);
  const missing = missingAnswers(draft, facts);
  if (missing.length > 0) return { ok: false, missing };

  const request = generateRequest(draft, facts);
  if (request.fields.useCaseDescription.length > USE_CASE_MAX) {
    return { ok: false, missing: [], tooLong: true };
  }
  return { ok: true, request, hash: hashRequest(request) };
}

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

/**
 * Records the human review. The client sends the hash of the text it showed;
 * the server regenerates and compares, so the sign-off is for exactly the text
 * that exists now — not a stale screen.
 */
export async function markReviewed(
  userId: string,
  environment: Environment,
  actor: string,
  shownHash: string,
): Promise<void> {
  const built = await buildRequest(userId, environment);
  if (!built.ok) throw new ReviewError("The request is incomplete.");
  if (built.hash !== shownHash) {
    throw new ReviewError("The request changed since it was displayed (an answer or a platform fact). Review it again.");
  }

  await getDb()
    .update(sandboxRequests)
    .set({ reviewedAt: new Date(), reviewedBy: actor, reviewedHash: built.hash })
    .where(and(eq(sandboxRequests.userId, userId), eq(sandboxRequests.environment, environment)));
}

export function isReviewed(row: SandboxRequest | null, currentHash: string | null): boolean {
  return Boolean(row?.reviewedAt && row.reviewedHash && currentHash && row.reviewedHash === currentHash);
}
