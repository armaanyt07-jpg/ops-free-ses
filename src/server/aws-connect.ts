import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { awsConnections, type AwsConnection, type Environment } from "@/db/schema";
import { log } from "@/lib/api/logger";
import {
  CONNECTION_TTL_MS,
  accountOfRoleArn,
  newConnectionId,
  newExternalId,
  quickCreateUrl,
  type CustomResourceRequest,
} from "@/lib/aws/connect";
import { PlatformAwsConfigError, oneClickAllowedFor, platformAws } from "@/lib/aws/platform";
import { deactivateRoleCredentialByExternalId, storeRoleCredential } from "@/server/credentials";

/**
 * One-click "Connect AWS" — Phase 10.
 *
 *   start    → a row with a fresh ExternalId, and the console link that bakes
 *              it into the role's trust policy.
 *   callback → the stack's custom resource tells us the role's ARN. A HINT, not
 *              proof: anyone who learned the ExternalId could send one.
 *   check    → the proof. We assume the role with the platform identity and call
 *              GetAccount through it; only then is a credential stored.
 *
 * Splitting callback from check also absorbs IAM's eventual consistency: a
 * freshly created role is sometimes not assumable for a few seconds, so the
 * dashboard simply retries instead of the callback blocking on it.
 */

/** Newest first; at most this many starts per tenant per hour. */
const MAX_STARTS_PER_HOUR = 6;
/** Keep retrying a refused role this long after the callback before giving up. */
const VERIFY_GRACE_MS = 90_000;

export class ConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectError";
  }
}

export async function startConnection(
  userId: string,
  environment: Environment,
  awsRegion: string,
  email: string | null = null,
): Promise<{ connectionId: string; url: string }> {
  const platform = platformAws();
  if (!platform || !oneClickAllowedFor(email)) {
    // Same answer whether it is off or still in preview: the button is hidden
    // either way, so this only fires for a hand-crafted request.
    throw new ConnectError("One-click connect is not available on this account yet.");
  }

  const db = getDb();
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(awsConnections)
    .where(and(eq(awsConnections.userId, userId), gt(awsConnections.createdAt, sql`now() - interval '1 hour'`)));
  if ((counted?.n ?? 0) >= MAX_STARTS_PER_HOUR) {
    throw new ConnectError("Too many connection attempts. Wait a few minutes and try again.");
  }

  // Only one live attempt at a time: an older pending click can no longer
  // complete once a newer one exists.
  await db
    .update(awsConnections)
    .set({ status: "expired", error: "Replaced by a newer attempt." })
    .where(and(eq(awsConnections.userId, userId), eq(awsConnections.status, "pending")));

  const externalId = newExternalId();
  const [row] = await db
    .insert(awsConnections)
    .values({
      userId,
      environment,
      externalId,
      awsRegion,
      expiresAt: new Date(Date.now() + CONNECTION_TTL_MS),
    })
    .returning();
  if (!row) throw new Error("Failed to create connection");

  log.security("aws_connect.started", userId, awsRegion);
  return {
    connectionId: row.id,
    url: quickCreateUrl(platform, { connectionId: newConnectionId(), externalId }),
  };
}

export type CallbackOutcome = { status: "SUCCESS" } | { status: "FAILED"; reason: string };

/**
 * Handles CloudFormation's custom-resource request. Always answers: an
 * unanswered request leaves the customer's stack hanging for an hour.
 */
export async function handleConnectCallback(req: CustomResourceRequest): Promise<CallbackOutcome> {
  const { ExternalId: externalId, RoleArn: roleArn } = req.ResourceProperties;

  if (req.RequestType === "Delete") {
    // The customer deleted the stack (or a failed create rolled back).
    const n = await deactivateRoleCredentialByExternalId(externalId);
    if (n > 0) log.security("aws_connect.stack_deleted", "aws-connect", "credential deactivated");
    await getDb()
      .update(awsConnections)
      .set({ status: "expired", error: "The CloudFormation stack was deleted." })
      .where(and(eq(awsConnections.externalId, externalId), eq(awsConnections.status, "pending")));
    return { status: "SUCCESS" };
  }

  const db = getDb();
  const [row] = await db.select().from(awsConnections).where(eq(awsConnections.externalId, externalId)).limit(1);

  if (!row || row.status === "expired" || row.status === "failed" || row.expiresAt.getTime() < Date.now()) {
    return { status: "FAILED", reason: "This connection request is unknown or has expired. Start again from the Ops-Free dashboard." };
  }
  if (!accountOfRoleArn(roleArn)) {
    return { status: "FAILED", reason: "The role ARN is not an Ops-Free role." };
  }

  await db
    .update(awsConnections)
    .set({ roleArn, callbackAt: new Date() })
    .where(eq(awsConnections.id, row.id));
  log.security("aws_connect.callback", row.userId, req.RequestType);
  return { status: "SUCCESS" };
}

export type ConnectionState =
  | { state: "waiting" }
  | { state: "verifying" }
  | { state: "connected" }
  | { state: "failed"; message: string };

function refusal(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  if (error instanceof PlatformAwsConfigError) return "One-click connect is not configured on this server.";
  if (name === "AccessDenied" || name === "AccessDeniedException") {
    return "AWS created the role but would not let Ops-Free use it. Delete the CloudFormation stack and start again.";
  }
  return `AWS would not let Ops-Free use the role (${name || "unknown error"}). Delete the CloudFormation stack and start again.`;
}

/**
 * Called on every poll from the dashboard. Idempotent, and scoped to the
 * caller: the row is looked up by id AND user.
 */
export async function checkConnection(userId: string, connectionId: string): Promise<ConnectionState> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(awsConnections)
    .where(and(eq(awsConnections.id, connectionId), eq(awsConnections.userId, userId)))
    .limit(1);

  if (!row) return { state: "failed", message: "That connection attempt was not found. Start again." };
  if (row.status === "connected") return { state: "connected" };
  if (row.status === "failed") return { state: "failed", message: row.error ?? "The connection failed." };
  if (row.status === "expired" || row.expiresAt.getTime() < Date.now()) {
    return { state: "failed", message: row.error ?? "This attempt expired. Start again." };
  }
  if (!row.roleArn || !row.callbackAt) return { state: "waiting" };

  return verify(row);
}

async function verify(row: AwsConnection): Promise<ConnectionState> {
  const db = getDb();
  try {
    await storeRoleCredential({
      userId: row.userId,
      environment: row.environment,
      roleArn: row.roleArn!,
      externalId: row.externalId,
      awsRegion: row.awsRegion,
    });
  } catch (error) {
    if (row.callbackAt && Date.now() - row.callbackAt.getTime() < VERIFY_GRACE_MS) {
      return { state: "verifying" };
    }
    const message = refusal(error);
    await db.update(awsConnections).set({ status: "failed", error: message }).where(eq(awsConnections.id, row.id));
    log.warn({
      event: "aws_connect.verify_failed",
      requestId: "aws-connect",
      userId: row.userId,
      detail: error instanceof Error ? error.name : "unknown",
    });
    return { state: "failed", message };
  }

  await db.update(awsConnections).set({ status: "connected", error: null }).where(eq(awsConnections.id, row.id));
  log.security("aws_connect.connected", row.userId, row.awsRegion);
  return { state: "connected" };
}
