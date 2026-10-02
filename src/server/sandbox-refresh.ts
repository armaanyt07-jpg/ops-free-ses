import "server-only";

import { log } from "@/lib/api/logger";
import type { Environment } from "@/db/schema";
import { revalidateCredential, type CredentialSummary } from "@/server/credentials";

/**
 * Keeps the sandbox / production-access status fresh without a background job
 * (Phase 9).
 *
 * The status the dashboard shows is a snapshot taken the last time AWS was
 * asked, and until now that was only when someone pressed "Re-validate". A
 * "waiting for AWS" message built on a days-old snapshot would be misleading,
 * so dashboard pages that show it call this first. It re-asks AWS (`GetAccount`,
 * the cheapest authenticated SES call) only when the account is still limited
 * by the sandbox and the snapshot is older than the cooldown, so a busy user
 * costs one AWS call per 15 minutes, and an account that has production access
 * costs none.
 *
 * It never throws and never makes a page wait long: a slow or failing AWS call
 * is logged and the page shows the snapshot it already had.
 */
export const SANDBOX_REFRESH_COOLDOWN_MS = 15 * 60 * 1000;
export const SANDBOX_REFRESH_TIMEOUT_MS = 3_000;

/** Pure, so the rule is tested without AWS. */
export function needsSandboxRefresh(
  credential: CredentialSummary | undefined,
  now: number = Date.now(),
): boolean {
  if (!credential || !credential.active) return false;
  // Production access doesn't go back to the sandbox through anything we show.
  if (credential.account?.productionAccessEnabled) return false;
  if (!credential.account || !credential.lastValidatedAt) return true;
  return now - credential.lastValidatedAt.getTime() >= SANDBOX_REFRESH_COOLDOWN_MS;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Returns the credential with a fresh snapshot, or the one it was given when no
 * refresh was due or the refresh failed.
 */
export async function withFreshSandboxStatus(
  userId: string,
  environment: Environment,
  credential: CredentialSummary | undefined,
): Promise<CredentialSummary | undefined> {
  if (!credential || !needsSandboxRefresh(credential)) return credential;

  try {
    const account = await withTimeout(
      revalidateCredential(userId, environment),
      SANDBOX_REFRESH_TIMEOUT_MS,
    );
    if (!account) return credential;
    return { ...credential, account, lastValidatedAt: new Date() };
  } catch (error) {
    log.warn({
      event: "sandbox.refresh_failed",
      requestId: "dashboard",
      userId,
      environment,
      detail: error instanceof Error ? error.name : "unknown",
    });
    return credential;
  }
}
