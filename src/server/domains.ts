import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import {
  verifiedDomains,
  type DomainStatus,
  type Environment,
  type VerifiedDomain,
} from "@/db/schema";
import { log } from "@/lib/api/logger";
import { attachConfigurationSet } from "@/lib/aws/events";
import { publishDkimRecords, type Route53Outcome } from "@/lib/aws/route53";
import { DecryptionError } from "@/lib/crypto/encryption";
import {
  expectedRecords,
  hostingPlatform,
  normaliseDomain,
  RECOMMENDED_DMARC,
  RECOMMENDED_SPF,
  type DkimResult,
  type DmarcResult,
  type DnsRecord,
  type SpfResult,
} from "@/lib/dns/checks";
import { checkDns } from "@/lib/dns/run";
import { isQueueConfigured } from "@/lib/queue/connection";
import {
  DOMAIN_JOB_OPTIONS,
  getDomainQueue,
  jobIdForDomain,
} from "@/lib/queue/domain-queue";
import {
  createDomainIdentity,
  getDomainIdentity,
  type SesDomainIdentity,
} from "@/lib/ses/client";
import { classifySesError } from "@/lib/ses/errors";

import { loadSesCredentials } from "./credentials";
import { hasManagedEvents } from "./events-setup";

/**
 * Domain & DNS verification manager — SRS FR-2, §10.
 *
 * Onboarding (§10 steps 1–2): create the SES identity with Easy DKIM in the
 * tenant's own AWS account, store the DKIM tokens, and show the records to
 * publish. Checking (steps 4–6): ask SES for the identity's state, and resolve
 * each record ourselves so a wrong value can be pointed at precisely.
 *
 * **SES is the authority on `status`.** `verified` means SES reports the
 * identity as verified for sending — nothing else. SPF and DMARC are checked
 * and reported, but they do not gate SES verification, and pretending they did
 * would make `status` disagree with what SES will actually accept.
 *
 * Every query is scoped by `userId`.
 */
export const CHECK_COOLDOWN_MS = 30_000;

export type SesIdentityState =
  | "verified"
  | "pending"
  | "failed"
  | "not_found"
  | "unavailable";

export interface DomainCheckResult {
  checkedAt: string;
  status: DomainStatus;
  region: string | null;
  sesIdentity: {
    status: SesIdentityState;
    verificationStatus: string | null;
    dkimStatus: string | null;
    detail: string | null;
  };
  dkim: DkimResult;
  spf: SpfResult;
  dmarc: DmarcResult;
}

export interface DomainView {
  id: string;
  domain: string;
  environment: Environment;
  status: DomainStatus;
  region: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  records: DnsRecord[];
  check: DomainCheckResult | null;
}

/** What `onboardDomain` automated beyond creating the identity (Phase 8). */
export interface OnboardResult extends DomainView {
  /** Route 53 publishing of the DKIM records; "no_zone" means publish by hand. */
  autoDns: Route53Outcome;
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

function tokensOf(row: VerifiedDomain): string[] {
  return Array.isArray(row.dkimTokens)
    ? (row.dkimTokens as unknown[]).filter(
        (t): t is string => typeof t === "string",
      )
    : [];
}

function toView(row: VerifiedDomain): DomainView {
  return {
    id: row.id,
    domain: row.domain,
    environment: row.environment,
    status: row.status,
    region: row.awsRegion,
    lastCheckedAt: row.lastCheckedAt,
    createdAt: row.createdAt,
    records: expectedRecords(row.domain, tokensOf(row)),
    check: (row.checkResult as DomainCheckResult | null) ?? null,
  };
}

function awsErrorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "UnknownError";
}

/**
 * SES's verified-for-sending flag decides `verified`. FAILED is terminal on the
 * SES side (records not found within its 72-hour window); anything else —
 * PENDING, NOT_STARTED, TEMPORARY_FAILURE — is still pending.
 */
function statusFromSes(identity: SesDomainIdentity): {
  status: DomainStatus;
  state: SesIdentityState;
} {
  if (identity.verifiedForSending) return { status: "verified", state: "verified" };
  if (identity.verificationStatus === "FAILED") {
    return { status: "failed", state: "failed" };
  }
  return { status: "pending", state: "pending" };
}

async function loadCredentialsOrNull(userId: string, environment: Environment) {
  try {
    return await loadSesCredentials(userId, environment);
  } catch (error) {
    if (error instanceof DecryptionError) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export interface OnboardInput {
  userId: string;
  environment: Environment;
  domain: string;
}

export async function onboardDomain(input: OnboardInput): Promise<OnboardResult> {
  const platform = hostingPlatform(input.domain);
  if (platform) {
    throw new DomainError(
      `${input.domain.trim()} belongs to ${platform}, and only ${platform} can add DNS records to it, so SES can't verify it. Send from your email address instead, or use a domain you own (you can point it at your ${platform} site too).`,
    );
  }

  const domain = normaliseDomain(input.domain);
  if (!domain) {
    throw new DomainError(
      "Enter a bare domain such as example.com — not a URL or an email address.",
    );
  }

  const credentials = await loadCredentialsOrNull(
    input.userId,
    input.environment,
  );
  if (!credentials) {
    throw new DomainError(
      `Add an active AWS credential for ${input.environment} first. The domain identity is created in that AWS account.`,
    );
  }

  let identity: SesDomainIdentity;
  try {
    identity = await createDomainIdentity(credentials, domain);
  } catch (error) {
    if (awsErrorName(error) !== "AlreadyExistsException") {
      throw new DomainError(
        `SES would not create the identity: ${classifySesError(error).message}`,
      );
    }
    // Already exists in this AWS account and region — adopt it rather than
    // fail. Someone may have started in the SES console.
    try {
      identity = await getDomainIdentity(credentials, domain);
    } catch (inner) {
      throw new DomainError(
        `The identity exists in SES but could not be read: ${classifySesError(inner).message}`,
      );
    }
  }

  const { status } = statusFromSes(identity);

  // Phase 8 automation, both best effort: a failure leaves the manual path.
  const autoDns: Route53Outcome =
    status === "verified"
      ? { status: "no_zone" }
      : await publishDkimRecords(credentials, domain, identity.dkimTokens);
  if (await hasManagedEvents(input.userId, input.environment)) {
    try {
      await attachConfigurationSet(credentials, domain);
    } catch (error) {
      log.warn({
        event: "domain.events_attach_failed",
        requestId: "domain",
        userId: input.userId,
        environment: input.environment,
        detail: awsErrorName(error),
      });
    }
  }

  const [row] = await getDb()
    .insert(verifiedDomains)
    .values({
      userId: input.userId,
      domain,
      environment: input.environment,
      status,
      awsRegion: credentials.region,
      dkimTokens: identity.dkimTokens,
      spfRecord: RECOMMENDED_SPF,
      dmarcRecord: RECOMMENDED_DMARC,
    })
    .onConflictDoUpdate({
      target: [
        verifiedDomains.userId,
        verifiedDomains.domain,
        verifiedDomains.environment,
      ],
      set: {
        status,
        awsRegion: credentials.region,
        dkimTokens: identity.dkimTokens,
      },
    })
    .returning();

  if (!row) throw new Error("Failed to persist domain");

  // A first check straight away: an adopted identity may already be verified,
  // and the user should see the real DNS state, not a blank checklist.
  const checked = await checkDomain(input.userId, row.id);
  if (checked?.status === "pending") await scheduleDomainPolling(row);

  return { ...(checked ?? toView(row)), autoDns };
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

async function checkSes(
  row: VerifiedDomain,
): Promise<{
  result: DomainCheckResult["sesIdentity"];
  status: DomainStatus;
  tokens: string[] | null;
}> {
  const keep = row.status;
  const credentials = await loadCredentialsOrNull(row.userId, row.environment);

  if (!credentials) {
    return {
      status: keep,
      tokens: null,
      result: {
        status: "unavailable",
        verificationStatus: null,
        dkimStatus: null,
        detail: `No usable AWS credential for ${row.environment}, so SES could not be asked. The status shown is from the last successful check.`,
      },
    };
  }

  if (row.awsRegion && credentials.region !== row.awsRegion) {
    return {
      status: keep,
      tokens: null,
      result: {
        status: "unavailable",
        verificationStatus: null,
        dkimStatus: null,
        detail: `This identity was created in ${row.awsRegion}, but the ${row.environment} credential now points at ${credentials.region}. SES identities are per region — switch the credential back, or remove and re-add the domain.`,
      },
    };
  }

  try {
    const identity = await getDomainIdentity(credentials, row.domain);
    const { status, state } = statusFromSes(identity);
    return {
      status,
      tokens: identity.dkimTokens.length > 0 ? identity.dkimTokens : null,
      result: {
        status: state,
        verificationStatus: identity.verificationStatus,
        dkimStatus: identity.dkimStatus,
        detail:
          state === "failed"
            ? `SES stopped looking for the DKIM records (it gives up after 72 hours). Publish them, then restart verification for this identity in the SES console (${credentials.region}).`
            : null,
      },
    };
  } catch (error) {
    if (awsErrorName(error) === "NotFoundException") {
      return {
        status: "failed",
        tokens: null,
        result: {
          status: "not_found",
          verificationStatus: null,
          dkimStatus: null,
          detail: `The identity no longer exists in SES (${credentials.region}). It may have been deleted in the AWS console. Remove and re-add the domain.`,
        },
      };
    }
    return {
      status: keep,
      tokens: null,
      result: {
        status: "unavailable",
        verificationStatus: null,
        dkimStatus: null,
        detail: `SES could not be reached: ${classifySesError(error).message}`,
      },
    };
  }
}

/**
 * Runs a full check and persists it. Returns null if the domain does not exist
 * for this tenant (including when it belongs to another tenant).
 */
export async function checkDomain(
  userId: string,
  domainId: string,
): Promise<DomainView | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(verifiedDomains)
    .where(
      and(eq(verifiedDomains.id, domainId), eq(verifiedDomains.userId, userId)),
    )
    .limit(1);

  if (!row) return null;

  const ses = await checkSes(row);
  // SES is the source of truth for the tokens; if the identity was recreated
  // they change, and the records shown must change with them.
  const tokens = ses.tokens ?? tokensOf(row);
  const dns = await checkDns(row.domain, tokens);

  const checkedAt = new Date();
  const result: DomainCheckResult = {
    checkedAt: checkedAt.toISOString(),
    status: ses.status,
    region: row.awsRegion,
    sesIdentity: ses.result,
    ...dns,
  };

  const [updated] = await db
    .update(verifiedDomains)
    .set({
      status: ses.status,
      dkimTokens: tokens,
      lastCheckedAt: checkedAt,
      checkResult: result,
    })
    .where(
      and(eq(verifiedDomains.id, row.id), eq(verifiedDomains.userId, userId)),
    )
    .returning();

  return updated ? toView(updated) : null;
}

/**
 * Returns the stored result if it is younger than the cooldown, otherwise
 * checks afresh. This is the rate limit on domain verification (SRS §9): a
 * user or script hammering "verify" costs at most one SES call and a handful
 * of DNS lookups per domain per cooldown window.
 */
export async function checkDomainIfStale(
  userId: string,
  domainId: string,
  maxAgeMs = CHECK_COOLDOWN_MS,
): Promise<{ view: DomainView; fresh: boolean } | null> {
  const [row] = await getDb()
    .select()
    .from(verifiedDomains)
    .where(
      and(eq(verifiedDomains.id, domainId), eq(verifiedDomains.userId, userId)),
    )
    .limit(1);

  if (!row) return null;

  if (
    row.lastCheckedAt &&
    Date.now() - row.lastCheckedAt.getTime() < maxAgeMs
  ) {
    return { view: toView(row), fresh: false };
  }

  const view = await checkDomain(userId, domainId);
  return view ? { view, fresh: true } : null;
}

/**
 * Arms bounded background polling. Best effort: if the queue is not
 * configured or reachable the domain still works — it just will not advance
 * until someone presses "Check now" — so this never fails the caller.
 */
export async function scheduleDomainPolling(
  row: Pick<VerifiedDomain, "id" | "userId">,
): Promise<boolean> {
  if (!isQueueConfigured()) return false;
  try {
    await getDomainQueue().add(
      "poll",
      { domainId: row.id, userId: row.userId },
      // Same id while a round is in flight, so re-arming never doubles up.
      { ...DOMAIN_JOB_OPTIONS, jobId: jobIdForDomain(row.id) },
    );
    return true;
  } catch (error) {
    log.warn({
      event: "domain.poll_schedule_failed",
      requestId: "domain",
      userId: row.userId,
      detail: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reads and removal
// ---------------------------------------------------------------------------

export async function listDomains(userId: string): Promise<DomainView[]> {
  const rows = await getDb()
    .select()
    .from(verifiedDomains)
    .where(eq(verifiedDomains.userId, userId))
    .orderBy(asc(verifiedDomains.createdAt));
  return rows.map(toView);
}

export async function findDomain(
  userId: string,
  domain: string,
  environment: Environment,
): Promise<DomainView | null> {
  const normalised = normaliseDomain(domain);
  if (!normalised) return null;

  const [row] = await getDb()
    .select()
    .from(verifiedDomains)
    .where(
      and(
        eq(verifiedDomains.userId, userId),
        eq(verifiedDomains.domain, normalised),
        eq(verifiedDomains.environment, environment),
      ),
    )
    .limit(1);
  return row ? toView(row) : null;
}

/**
 * Stops tracking a domain. The SES identity is deliberately left in place:
 * the customer's other systems may send through it, and deleting an identity
 * in their AWS account is not a side effect this dashboard should have.
 */
export async function removeDomain(
  userId: string,
  domainId: string,
): Promise<boolean> {
  const rows = await getDb()
    .delete(verifiedDomains)
    .where(
      and(eq(verifiedDomains.id, domainId), eq(verifiedDomains.userId, userId)),
    )
    .returning({ id: verifiedDomains.id });
  return rows.length > 0;
}
