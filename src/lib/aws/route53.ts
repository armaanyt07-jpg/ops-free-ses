import "server-only";

import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  Route53Client,
} from "@aws-sdk/client-route-53";

import { dkimRecordName, dkimRecordTarget } from "@/lib/dns/checks";
import type { SesCredentials } from "@/lib/ses/client";

/**
 * Optional DNS automation (Phase 8): when the domain's public hosted zone is
 * in the same AWS account, publish the three DKIM CNAMEs there so the
 * customer has nothing to copy.
 *
 * Best effort by design. No zone, no permission, or any AWS error simply
 * means the customer publishes the records by hand, as before — so this never
 * throws, it reports what happened.
 */
export type Route53Outcome =
  | { status: "published"; zone: string }
  | { status: "no_zone" }
  | { status: "denied" }
  | { status: "failed"; error: string };

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "UnknownError";
}

/** example.com, then its parents: a.b.example.com → b.example.com → example.com. */
export function candidateZones(domain: string): string[] {
  const labels = domain.split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out;
}

export async function publishDkimRecords(
  credentials: SesCredentials,
  domain: string,
  tokens: string[],
): Promise<Route53Outcome> {
  if (tokens.length === 0) return { status: "no_zone" };

  // Route 53 is a global service; its API lives in us-east-1.
  const client = new Route53Client({
    region: "us-east-1",
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    maxAttempts: 2,
  });

  try {
    let zoneId: string | null = null;
    let zoneName: string | null = null;

    for (const candidate of candidateZones(domain)) {
      const out = await client.send(
        new ListHostedZonesByNameCommand({ DNSName: candidate, MaxItems: 5 }),
      );
      const match = out.HostedZones?.find(
        (z) => z.Name === `${candidate}.` && !z.Config?.PrivateZone,
      );
      if (match?.Id) {
        zoneId = match.Id.replace(/^\/hostedzone\//, "");
        zoneName = candidate;
        break;
      }
    }
    if (!zoneId || !zoneName) return { status: "no_zone" };

    await client.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: zoneId,
        ChangeBatch: {
          Comment: "Ops-Free SES: Easy DKIM records",
          Changes: tokens.map((token) => ({
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: dkimRecordName(domain, token),
              Type: "CNAME",
              TTL: 1800,
              ResourceRecords: [{ Value: dkimRecordTarget(token) }],
            },
          })),
        },
      }),
    );
    return { status: "published", zone: zoneName };
  } catch (error) {
    const name = errorName(error);
    if (name === "AccessDenied" || name === "AccessDeniedException") return { status: "denied" };
    return { status: "failed", error: name };
  } finally {
    client.destroy();
  }
}
