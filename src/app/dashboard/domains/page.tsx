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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckBadge, DomainStatusBadge } from "@/components/dashboard/check-badge";
import { DomainForm } from "@/components/dashboard/domain-form";
import type { CheckStatus } from "@/lib/dns/checks";
import { PageHeader, Time } from "@/components/dashboard/primitives";
import { listDomains, type DomainView } from "@/server/domains";
import { getActiveEnvironment } from "@/server/environment";
import { requireTenant } from "@/server/tenant";

import { checkDomainNow, deleteDomain } from "./actions";

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
          <Badge variant="outline">{view.environment}</Badge>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Purpose</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.records.map((record) => (
                <TableRow key={`${record.type}-${record.name}`}>
                  <TableCell>{record.purpose}</TableCell>
                  <TableCell className="font-mono text-xs">{record.type}</TableCell>
                  <TableCell className="font-mono text-xs break-all whitespace-normal select-all">
                    {record.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs break-all whitespace-normal select-all">
                    {record.value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground text-xs">
            Many DNS providers add your domain to the name automatically — if
            yours does, enter only the part before{" "}
            <code>{view.domain}</code>. If you already publish an SPF record,
            add <code>include:amazonses.com</code> to it rather than creating a
            second one: two SPF records make SPF fail outright.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function DomainsPage() {
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);
  const all = await listDomains(tenant.id);
  const domains = all.filter((d) => d.environment === environment);
  const elsewhere = all.length - domains.length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Domains"
        description={
          <>
            Sending domains are created as identities in your own SES account, in the region of
            the environment&apos;s AWS credential. Showing{" "}
            <strong className="text-foreground">{environment}</strong>
            {elsewhere > 0
              ? ` — ${elsewhere} more in the other environment.`
              : "."}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Add a domain</CardTitle>
          <CardDescription>
            Creates the SES identity with Easy DKIM and lists the DNS records to
            publish. Requires an active AWS credential for the environment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DomainForm defaultEnvironment={environment} />
        </CardContent>
      </Card>

      {domains.length === 0 ? (
        <Alert>
          <AlertTitle>No {environment} domains yet</AlertTitle>
          <AlertDescription>
            Until a domain is verified, SES rejects mail from it.
          </AlertDescription>
        </Alert>
      ) : (
        domains.map((view) => <DomainCard key={view.id} view={view} />)
      )}

      <p className="text-muted-foreground text-xs">
        Removing a domain here stops tracking it. The identity is left in your
        SES account, since other systems may send through it.
      </p>
    </div>
  );
}
