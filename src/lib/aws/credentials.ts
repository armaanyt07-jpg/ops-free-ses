import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

import { PlatformAwsConfigError, platformAws } from "@/lib/aws/platform";
import type { SesCredentials } from "@/lib/ses/client";

/**
 * Turns a stored credential into what an AWS SDK client accepts (Phase 10).
 *
 *   - access keys are passed straight through;
 *   - a role is assumed with the platform's identity, proving the `ExternalId`
 *     the customer's trust policy requires. The short-lived result is cached
 *     per role, because one STS call per email would add a round trip to the
 *     send path.
 *
 * Sessions last 15 minutes, the minimum, so deleting the role (or its stack)
 * in the customer's account cuts us off within a quarter of an hour even for
 * a warm worker. Refreshed when under two minutes remain.
 */
export interface AssumedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

export const SESSION_SECONDS = 900;
const REFRESH_BEFORE_MS = 120_000;

type Provider = () => Promise<AssumedCredentials>;
export type AssumeFn = (input: {
  roleArn: string;
  externalId: string;
  sessionName: string;
  region: string;
}) => Promise<AssumedCredentials>;

/** The real STS call; replaced in tests. */
export const assumeRoleViaSts: AssumeFn = async ({ roleArn, externalId, sessionName }) => {
  const platform = platformAws();
  if (!platform) throw new PlatformAwsConfigError("One-click AWS connect is not configured on this server.");

  // STS answers in the platform's own region: the customer's SES region says
  // nothing about where STS is reachable and enabled.
  const client = new STSClient({
    region: platform.region,
    credentials: { accessKeyId: platform.accessKeyId, secretAccessKey: platform.secretAccessKey },
    maxAttempts: 2,
  });
  try {
    const out = await client.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: sessionName,
        ExternalId: externalId,
        DurationSeconds: SESSION_SECONDS,
      }),
    );
    const c = out.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
      throw new Error("STS returned no credentials");
    }
    return {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
      expiration: c.Expiration,
    };
  } finally {
    client.destroy();
  }
};

interface Entry {
  value?: AssumedCredentials;
  inflight?: Promise<AssumedCredentials>;
}

const cache = new Map<string, Entry>();
let assume: AssumeFn = assumeRoleViaSts;

/** Tests swap the STS call and clear the cache. */
export function __setAssumeForTests(fn: AssumeFn | null): void {
  assume = fn ?? assumeRoleViaSts;
  cache.clear();
}

function fresh(c: AssumedCredentials | undefined, now: number): c is AssumedCredentials {
  return Boolean(c) && c!.expiration.getTime() - now > REFRESH_BEFORE_MS;
}

export async function assumedCredentials(
  creds: Pick<Extract<SesCredentials, { roleArn: string }>, "roleArn" | "externalId" | "sessionName" | "region">,
  now: () => number = Date.now,
): Promise<AssumedCredentials> {
  // The external id is part of the key: a role re-created with a new id must
  // not be served an old session.
  const key = `${creds.roleArn}|${creds.externalId}`;
  const entry = cache.get(key) ?? {};
  cache.set(key, entry);

  if (fresh(entry.value, now())) return entry.value;
  // Concurrent sends for one tenant share a single STS call.
  if (entry.inflight) return entry.inflight;

  entry.inflight = assume(creds)
    .then((value) => {
      entry.value = value;
      return value;
    })
    .finally(() => {
      delete entry.inflight;
    });
  return entry.inflight;
}

/** Credentials for an SDK client: static for keys, a refreshing provider for roles. */
export function awsCredentialsFor(
  creds: SesCredentials,
): { accessKeyId: string; secretAccessKey: string } | Provider {
  if (creds.roleArn === undefined) {
    return { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey };
  }
  const role = creds;
  return () => assumedCredentials(role);
}
