import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  PageHeader,
  Pagination,
  Time,
} from "@/components/dashboard/primitives";
import {
  AddSuppressionForm,
  RemoveSuppressionForm,
} from "@/components/dashboard/suppression-forms";
import { PAGE_SIZE, parsePage, type SearchParams } from "@/lib/dashboard/params";
import { listSuppressionAudit, listSuppressions } from "@/server/suppression";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

const PATH = "/dashboard/suppressions";

const REASON_LABEL: Record<string, string> = {
  hard_bounce: "hard bounce",
  soft_bounce: "soft bounce",
  complaint: "complaint",
  manual: "added manually",
};

/**
 * Suppression management — SRS §12 "Search, reason, source event, active
 * state", and §11's requirement that manual changes be explicit and auditable.
 */
export default async function SuppressionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const q = typeof params.q === "string" ? params.q.slice(0, 200) : undefined;
  const includeInactive = params.all === "1";
  const page = parsePage(params);

  const [result, audit] = await Promise.all([
    listSuppressions(tenant.id, { search: q, includeInactive, page, pageSize: PAGE_SIZE }),
    listSuppressionAudit(tenant.id, 10),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Suppressions"
        description={
          <>
            Addresses that will not be sent to. The API refuses them with{" "}
            <code>RECIPIENT_SUPPRESSED</code> and the worker checks again just before SES. Shared
            by staging and production; transient bounces never suppress.
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Suppress an address</CardTitle>
          <CardDescription>
            For opt-outs and known-bad addresses. Hard bounces and complaints are added
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddSuppressionForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suppressed addresses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-wrap items-center gap-3" method="get">
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search by address"
              aria-label="Search by address"
              className="w-full sm:max-w-72"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="all" value="1" defaultChecked={includeInactive} />
              Include removed
            </label>
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
            {q || includeInactive ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={PATH}>Clear</Link>
              </Button>
            ) : null}
          </form>

          {result.rows.length === 0 ? (
            <EmptyState title={q ? "No matching addresses" : "Nothing is suppressed"} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="hidden lg:table-cell">Source event</TableHead>
                  <TableHead className="hidden sm:table-cell">Since</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs break-all whitespace-normal">{row.email}</TableCell>
                    <TableCell>{REASON_LABEL[row.reason] ?? row.reason}</TableCell>
                    <TableCell className="text-muted-foreground hidden font-mono text-xs lg:table-cell">
                      {row.sourceEventId ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                      <Time date={row.createdAt} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.active ? "destructive" : "secondary"}>
                        {row.active ? "active" : "removed"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-normal">
                      {row.active ? <RemoveSuppressionForm email={row.email} reason={row.reason} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Pagination
            path={PATH}
            params={params}
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            pageSize={PAGE_SIZE}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent manual changes</CardTitle>
          <CardDescription>
            Every manual add or removal, with who made it and why. Automatic suppressions are
            traceable through their source SNS event instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <EmptyState title="No manual changes yet" />
          ) : (
            <ul className="divide-y text-sm">
              {audit.map((entry) => {
                const detail = (entry.detail ?? {}) as { note?: string };
                return (
                  <li key={entry.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-3">
                    <Badge variant="outline" className="w-fit">
                      {entry.action === "suppression.add" ? "added" : "removed"}
                    </Badge>
                    <span className="font-mono text-xs break-all">{entry.target}</span>
                    <span className="text-muted-foreground min-w-0 flex-1">“{detail.note}”</span>
                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                      {entry.actor} · <Time date={entry.createdAt} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
