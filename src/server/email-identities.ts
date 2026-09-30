import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { emailIdentities, type EmailIdentity, type Environment } from "@/db/schema";
import { log } from "@/lib/api/logger";
import { attachConfigurationSet } from "@/lib/aws/events";
import { createDomainIdentity, getDomainIdentity } from "@/lib/ses/client";
import { classifySesError } from "@/lib/ses/errors";

import { loadSesCredentials } from "./credentials";
import { hasManagedEvents } from "./events-setup";

/**
 * Email-address identities — Phase 8, for users without a domain.
 *
 * SES verifies an address by emailing it a confirmation link. There is no DNS
 * to check, so there is no background poller: the status is refreshed from
 * SES when the user asks, and when a page showing a pending address renders
 * (bounded by a cooldown). SES's CreateEmailIdentity / GetEmailIdentity are
 * the same calls as for domains, so the domain client functions are reused.
 */
export class EmailIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailIdentityError";
  }
}

/** Re-asking SES more often than this adds nothing. */
export const EMAIL_CHECK_COOLDOWN_MS = 15_000;

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "UnknownError";
}

export function normaliseEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  return z.string().email().max(320).safeParse(value).success ? value : null;
}

export async function addEmailIdentity(input: {
  userId: string;
  environment: Environment;
  email: string;
}): Promise<EmailIdentity> {
  const email = normaliseEmail(input.email);
  if (!email) throw new EmailIdentityError("Enter a valid email address.");

  const credentials = await loadSesCredentials(input.userId, input.environment);
  if (!credentials) {
    throw new EmailIdentityError(`Connect your AWS account for ${input.environment} first.`);
  }

  let verified: boolean;
  try {
    // Sends the confirmation email.
    verified = (await createDomainIdentity(credentials, email)).verifiedForSending;
  } catch (error) {
    if (errorName(error) !== "AlreadyExistsException") {
      throw new EmailIdentityError(`SES would not add the address: ${classifySesError(error).message}`);
    }
    // Already in this AWS account (maybe added in the SES console): adopt it.
    try {
      verified = (await getDomainIdentity(credentials, email)).verifiedForSending;
    } catch (inner) {
      throw new EmailIdentityError(`The address exists in SES but could not be read: ${classifySesError(inner).message}`);
    }
  }

  const status = verified ? "verified" : "pending";
  const [row] = await getDb()
    .insert(emailIdentities)
    .values({
      userId: input.userId,
      email,
      environment: input.environment,
      status,
      awsRegion: credentials.region,
      lastCheckedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [emailIdentities.userId, emailIdentities.email, emailIdentities.environment],
      set: { status, awsRegion: credentials.region, lastCheckedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Failed to persist email identity");

  if (await hasManagedEvents(input.userId, input.environment)) {
    try {
      await attachConfigurationSet(credentials, email);
    } catch (error) {
      log.warn({
        event: "email_identity.events_attach_failed",
        requestId: "email-identity",
        userId: input.userId,
        environment: input.environment,
        detail: errorName(error),
      });
    }
  }

  return row;
}

/** Asks SES for the current status. Null when the row isn't this tenant's. */
export async function checkEmailIdentity(
  userId: string,
  id: string,
  { force = true }: { force?: boolean } = {},
): Promise<EmailIdentity | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailIdentities)
    .where(and(eq(emailIdentities.id, id), eq(emailIdentities.userId, userId)))
    .limit(1);
  if (!row) return null;

  const fresh =
    row.lastCheckedAt && Date.now() - row.lastCheckedAt.getTime() < EMAIL_CHECK_COOLDOWN_MS;
  // Page renders respect the cooldown; an explicit "check now" does not.
  if (fresh && !force) return row;

  const credentials = await loadSesCredentials(userId, row.environment);
  // No credential, or it moved region: keep the last known status.
  if (!credentials || credentials.region !== row.awsRegion) return row;

  let status = row.status;
  try {
    const identity = await getDomainIdentity(credentials, row.email);
    status = identity.verifiedForSending
      ? "verified"
      : identity.verificationStatus === "FAILED"
        ? "failed"
        : "pending";
  } catch (error) {
    if (errorName(error) === "NotFoundException") status = "failed";
    else return row; // SES unreachable: keep what we had.
  }

  const [updated] = await db
    .update(emailIdentities)
    .set({ status, lastCheckedAt: new Date() })
    .where(eq(emailIdentities.id, row.id))
    .returning();
  return updated ?? row;
}

export async function listEmailIdentities(userId: string): Promise<EmailIdentity[]> {
  return getDb()
    .select()
    .from(emailIdentities)
    .where(eq(emailIdentities.userId, userId))
    .orderBy(asc(emailIdentities.createdAt));
}

/**
 * For pages that show pending addresses: refresh up to a few of them from
 * SES, respecting the cooldown, so a clicked link shows up on the next load.
 */
export async function refreshPendingEmailIdentities(userId: string): Promise<EmailIdentity[]> {
  const rows = await listEmailIdentities(userId);
  const pending = rows.filter((r) => r.status === "pending").slice(0, 3);
  if (pending.length === 0) return rows;
  await Promise.all(pending.map((r) => checkEmailIdentity(userId, r.id, { force: false })));
  return listEmailIdentities(userId);
}

/** Stops tracking the address; the identity stays in the customer's SES. */
export async function removeEmailIdentity(userId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(emailIdentities)
    .where(and(eq(emailIdentities.id, id), eq(emailIdentities.userId, userId)))
    .returning({ id: emailIdentities.id });
  return rows.length > 0;
}
