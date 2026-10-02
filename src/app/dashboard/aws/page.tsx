import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GREEN } from "@/components/dashboard/badge-tones";
import { cn } from "@/lib/utils";
import { AwsConnectOptions } from "@/components/dashboard/aws-connect-options";
import { Fields, PageHeader, Time } from "@/components/dashboard/primitives";
import { ProductionAccessCard } from "@/components/dashboard/production-access-card";
import { RevalidateButton } from "@/components/dashboard/revalidate-button";
import { describeAccess } from "@/lib/sandbox/access-state";
import { formatCount } from "@/lib/dashboard/format";
import { listCredentials, type CredentialSummary } from "@/server/credentials";
import { getActiveEnvironment } from "@/server/environment";
import { getSandboxRequest } from "@/server/sandbox";
import { withFreshSandboxStatus } from "@/server/sandbox-refresh";
import { requireTenant } from "@/server/tenant";

import { removeCredential, toggleCredential } from "./actions";

export const dynamic = "force-dynamic";

/** Daily quota as a meter; the fill turns amber near the limit, with a label. */
function QuotaMeter({ used, max }: { used: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const near = ratio >= 0.8;
  return (
    <div className="space-y-1">
      <div
        className="h-2 overflow-hidden rounded-full bg-sky-100"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
        aria-label="Emails sent in the last 24 hours"
      >
        <div
          className={`h-full rounded-full ${near ? "bg-amber-500" : "bg-sky-600"}`}
          style={{ width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {formatCount(used)} of {formatCount(max)} in the last 24 h
        {near ? " — close to the daily limit" : ""}
      </p>
    </div>
  );
}

function CredentialCard({ credential }: { credential: CredentialSummary }) {
  const account = credential.account;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              AWS credential
              <Badge variant="secondary" className={cn(credential.active ? GREEN : undefined)}>
                {credential.active ? "active" : "revoked"}
              </Badge>
            </CardTitle>
            <CardDescription>
              Last validated <Time date={credential.lastValidatedAt} fallback="never" />
            </CardDescription>
          </div>
          {credential.active ? <RevalidateButton /> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <Fields
            items={[
              credential.kind === "role"
                ? ["Connected via", <span key="k" className="font-mono text-xs break-all">IAM role · {credential.roleArn}</span>]
                : ["Access key ID", <span key="k" className="font-mono text-xs">{credential.accessKeyId}</span>],
              ["Region", credential.awsRegion],
              [
                "Secret",
                <span key="s" className="text-muted-foreground">
                  {credential.kind === "role" ? "none stored · short-lived sessions only" : "stored encrypted · never shown"}
                </span>,
              ],
              [
                "Enforcement",
                account?.enforcementStatus ? (
                  <Badge key="e" variant={account.enforcementStatus === "HEALTHY" ? "outline" : "destructive"}>
                    {account.enforcementStatus}
                  </Badge>
                ) : (
                  "—"
                ),
              ],
            ]}
          />
          <div className="space-y-4">
            <Fields
              items={[
                [
                  "Max send rate",
                  account?.maxSendRate != null ? `${account.maxSendRate} emails / second` : "—",
                ],
              ]}
            />
            {account?.max24HourSend != null && account.sentLast24Hours != null ? (
              <QuotaMeter used={account.sentLast24Hours} max={account.max24HourSend} />
            ) : null}
            <p className="text-muted-foreground text-xs">
              The worker&apos;s rate limiter uses the max send rate, so a burst never exceeds
              what AWS allows. Snapshot as of the last validation.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <form action={toggleCredential}>
            <input type="hidden" name="id" value={credential.id} />
            <input type="hidden" name="active" value={String(!credential.active)} />
            <Button type="submit" variant="outline" size="sm">
              {credential.active ? "Revoke" : "Re-activate"}
            </Button>
          </form>
          <form action={removeCredential}>
            <input type="hidden" name="id" value={credential.id} />
            <Button type="submit" variant="ghost" size="sm" className="text-red-700">
              Delete
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

/** SRS §12 AWS: "Credential status, region, quota snapshot, sandbox state". */
export default async function AwsPage() {
  const tenant = await requireTenant();
  const [environment, credentials] = await Promise.all([
    getActiveEnvironment(tenant.id),
    listCredentials(tenant.id),
  ]);
  const listed = credentials.find((c) => c.environment === environment);
  const current = await withFreshSandboxStatus(tenant.id, environment, listed);
  const sandboxRow = current ? await getSandboxRequest(tenant.id, environment) : null;
  const access = describeAccess(current?.account ?? null, {
    connected: Boolean(current?.active),
    prepared: Boolean(sandboxRow?.reviewedAt),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="AWS"
        description="Your own SES account does the sending. The credential is validated against AWS before it is saved."
      />

      {current?.active ? <ProductionAccessCard view={access} /> : null}

      {current ? (
        <CredentialCard credential={current} />
      ) : (
        <Alert>
          <AlertTitle>AWS isn&apos;t connected yet</AlertTitle>
          <AlertDescription>
            Nothing can be sent until a credential is added below.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{current ? "Replace the credential" : "Connect your AWS account"}</CardTitle>
          <CardDescription>
            {current
              ? "Connecting again replaces the current credential — that is how rotation works."
              : "Connect with one click, or with an access key."}{" "}
            Either way we can set up delivery events and, if your DNS is in Route 53, publish your
            domain&apos;s records for you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AwsConnectOptions />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Sending identities live on{" "}
        <Link href="/dashboard/domains" className="underline underline-offset-4">
          Domains
        </Link>
        ; delivery events on{" "}
        <Link href="/dashboard/webhooks" className="underline underline-offset-4">
          Webhooks
        </Link>
        .
      </p>
    </div>
  );
}
