import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckBadge, DomainStatusBadge } from "@/components/dashboard/check-badge";
import { DomainForm } from "@/components/dashboard/domain-form";
import type { CheckStatus } from "@/lib/dns/checks";
import { DnsRecords } from "@/components/dashboard/dns-records";
import { PageHeader, Time } from "@/components/dashboard/primitives";
import { EmailIdentityForm } from "@/components/dashboard/email-identity-form";
import { EmailIdentityPending } from "@/components/dashboard/email-identity-status";
import { listDomains, type DomainView } from "@/server/domains";
import { refreshPendingEmailIdentities } from "@/server/email-identities";
import { getActiveEnvironment } from "@/server/environment";
import { requireTenant } from "@/server/tenant";

import { checkDomainNow, deleteDomain, deleteEmailIdentity } from "./actions";

export const dynamic = "force-dynamic";

function sesCheckStatus(view: DomainView): CheckStatus {
  switch (view.check?.sesIdentity.status) {
    case "verified":
      return "pass";
    case "failed":
    case "not_found":
      return "fail";
    case "pending":
      return "warn";
    default:
      return "unknown";
  }
}

function ChecklistRow({
  label,
  status,
  summary,
  problems,
}: {
  label: string;
  status: CheckStatus;
  summary: string;
  problems: string[];
}) {
  return (
    <li className="flex gap-3 py-3">
      <div className="w-16 shrink-0">
        <CheckBadge status={status} />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">
          {label}{" "}
          <span className="text-muted-foreground font-normal">— {summary}</span>
        </p>
        {problems.map((p) => (
          <p key={p} className="text-muted-foreground text-xs break-words">
            {p}
          </p>
        ))}
      </div>
    </li>
  );
}

function DomainCard({ view }: { view: DomainView }) {
  const check = view.check;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="font-mono text-lg">{view.domain}</CardTitle>
          <DomainStatusBadge status={view.status} />
          <Badge variant="outline">{view.region ?? "region unknown"}</Badge>

          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <form action={checkDomainNow}>
              <input type="hidden" name="id" value={view.id} />
              <Button type="submit" variant="outline" size="sm">
                Check now
              </Button>
            </form>
            <form action={deleteDomain}>
              <input type="hidden" name="id" value={view.id} />
              <Button type="submit" variant="ghost" size="sm">
                Remove
              </Button>
            </form>
          </div>
        </div>
        <CardDescription>
          Last checked{" "}
          {view.lastCheckedAt ? <Time date={view.lastCheckedAt} /> : "never"}.
          {view.status === "pending"
            ? " Checked automatically in the background, with increasing gaps, for about a day."
            : null}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {check ? (
          <ul className="divide-y">
            <ChecklistRow
              label="SES identity"
              status={sesCheckStatus(view)}
              summary={
                check.sesIdentity.verificationStatus
                  ? `SES reports ${check.sesIdentity.verificationStatus.toLowerCase()}${check.sesIdentity.dkimStatus ? `, DKIM ${check.sesIdentity.dkimStatus.toLowerCase()}` : ""}`
                  : check.sesIdentity.status
              }
              problems={check.sesIdentity.detail ? [check.sesIdentity.detail] : []}
            />
            <ChecklistRow
              label="DKIM"
              status={check.dkim.status}
              summary={`${check.dkim.records.filter((r) => r.status === "pass").length} of ${check.dkim.records.length} CNAME records resolve correctly`}
              problems={check.dkim.problems}
            />
            <ChecklistRow
              label="SPF"
              status={check.spf.status}
              summary={check.spf.found[0] ?? "no record found"}
              problems={check.spf.problems}
            />
            <ChecklistRow
              label="DMARC"
              status={check.dmarc.status}
              summary={
                check.dmarc.policy ? `policy ${check.dmarc.policy}` : "no valid record"
              }
              problems={check.dmarc.problems}
            />
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Not checked yet.</p>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">DNS records to publish</h3>
          <DnsRecords domain={view.domain} records={view.records} />
        </div>
      </CardContent>
    </Card>
  );
}

export default async function DomainsPage() {
  const tenant = await requireTenant();
  const [environment, all, allEmails] = await Promise.all([
    getActiveEnvironment(tenant.id),
    listDomains(tenant.id),
    refreshPendingEmailIdentities(tenant.id),
  ]);
  const emails = allEmails.filter((e) => e.environment === environment);
  const domains = all.filter((d) => d.environment === environment);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Domains"
        description="Sending domains are created as identities in your own SES account, in the region of your AWS credential."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add a domain</CardTitle>
          <CardDescription>
            Creates the SES identity with Easy DKIM and lists the DNS records to
            publish. Requires a connected AWS account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DomainForm />
        </CardContent>
      </Card>

      {domains.length === 0 ? (
        <Alert>
          <AlertTitle>No domains yet</AlertTitle>
          <AlertDescription>
            Until a domain is verified, SES rejects mail from it.
          </AlertDescription>
        </Alert>
      ) : (
        domains.map((view) => <DomainCard key={view.id} view={view} />)
      )}

      <Card>
        <CardHeader>
          <CardTitle>Email addresses</CardTitle>
          <CardDescription>
            No domain? Verify a single address instead: Amazon emails it a confirmation link.
            It keeps working after you go live; a domain of your own gets better inbox placement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {emails.length > 0 ? (
            <ul className="space-y-3">
              {emails.map((identity) =>
                identity.status === "verified" ? (
                  <li key={identity.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-mono">{identity.email}</span>
                    <DomainStatusBadge status="verified" />
                    <form action={deleteEmailIdentity} className="ml-auto">
                      <input type="hidden" name="id" value={identity.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Remove
                      </Button>
                    </form>
                  </li>
                ) : (
                  <li key={identity.id}>
                    <EmailIdentityPending identity={identity} />
                  </li>
                ),
              )}
            </ul>
          ) : null}
          <EmailIdentityForm />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Removing a domain or address here stops tracking it. The identity is left in your
        SES account, since other systems may send through it.
      </p>
    </div>
  );
}
