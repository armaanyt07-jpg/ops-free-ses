import { CopyButton } from "@/components/dashboard/copy-button";
import type { DnsRecord } from "@/lib/dns/checks";

/**
 * DNS records to publish, one card per record with copy buttons on the parts
 * people paste. Stacks on a phone instead of scrolling a table sideways.
 */
export function DnsRecords({ domain, records }: { domain: string; records: DnsRecord[] }) {
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {records.map((record) => (
          <li key={`${record.type}-${record.name}`} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="bg-muted rounded px-1.5 py-0.5 font-mono font-medium">{record.type}</span>
              <span className="text-muted-foreground">
                {record.purpose}
                {record.purpose === "DKIM" ? " · required" : " · recommended"}
              </span>
            </div>
            <dl className="grid gap-1.5 text-xs sm:grid-cols-[4rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground pt-1.5">Name</dt>
              <dd className="flex items-center gap-2">
                <code className="bg-muted/60 min-w-0 flex-1 rounded px-2 py-1 font-mono break-all">
                  {record.name}
                </code>
                <CopyButton text={record.name} label={`Copy ${record.purpose} name`} iconOnly />
              </dd>
              <dt className="text-muted-foreground pt-1.5">Value</dt>
              <dd className="flex items-center gap-2">
                <code className="bg-muted/60 min-w-0 flex-1 rounded px-2 py-1 font-mono break-all">
                  {record.value}
                </code>
                <CopyButton text={record.value} label={`Copy ${record.purpose} value`} iconOnly />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        Many DNS providers add your domain to the name automatically. If yours does, enter
        only the part before <code>{domain}</code>. If you already have an SPF record, add{" "}
        <code>include:amazonses.com</code> to it instead of creating a second one.
      </p>
    </div>
  );
}
