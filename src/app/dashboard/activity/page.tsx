import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import {
  EmptyState,
  PageHeader,
  Pagination,
  Time,
} from "@/components/dashboard/primitives";
import { emailStatusEnum } from "@/db/schema";
import {
  dayValue,
  PAGE_SIZE,
  parseActivityFilters,
  parsePage,
  type SearchParams,
} from "@/lib/dashboard/params";
import { searchActivity } from "@/server/activity";
import { getActiveEnvironment } from "@/server/environment";
import { listTemplates } from "@/server/templates";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

const PATH = "/dashboard/activity";

/**
 * Email activity explorer — SRS §12 "Search by recipient, message ID, subject,
 * template, status, date". Every filter is a query parameter, so any view is a
 * link.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);
  const filters = parseActivityFilters(params);
  const page = parsePage(params);

  const [result, templates] = await Promise.all([
    searchActivity(tenant.id, environment, filters, page),
    listTemplates(tenant.id, { includeArchived: true, pageSize: 200 }),
  ]);
  const templateName = new Map(templates.rows.map((t) => [t.id, t.name]));
  const filtered = Boolean(
    filters.q || filters.status || filters.errorCode || filters.templateId || filters.from || filters.to,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="Every message you've sent, newest first. Open one for its timeline, per-recipient outcome and errors."
      />

      <Card className="py-4">
        <CardContent className="px-4">
          <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
            <div className="space-y-1 sm:col-span-2 lg:col-span-1">
              <label htmlFor="q" className="text-muted-foreground text-xs font-medium">
                Search
              </label>
              <Input
                id="q"
                name="q"
                defaultValue={filters.q ?? ""}
                placeholder="Recipient, subject, sender, SES message ID or log ID"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="status" className="text-muted-foreground text-xs font-medium">
                Status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={filters.status ?? ""}
                className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="">Any status</option>
                {emailStatusEnum.enumValues.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="template" className="text-muted-foreground text-xs font-medium">
                Template
              </label>
              <select
                id="template"
                name="template"
                defaultValue={filters.templateId ?? ""}
                className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="">Any template</option>
                {templates.rows.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="from" className="text-muted-foreground text-xs font-medium">
                From (UTC)
              </label>
              <Input id="from" name="from" type="date" defaultValue={dayValue(filters.from)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="to" className="text-muted-foreground text-xs font-medium">
                To (UTC)
              </label>
              <Input id="to" name="to" type="date" defaultValue={dayValue(filters.to)} />
            </div>
            {filters.errorCode ? <input type="hidden" name="error" value={filters.errorCode} /> : null}
            <div className="flex items-end gap-2">
              <Button type="submit">Apply</Button>
              {filtered ? (
                <Button asChild variant="ghost">
                  <Link href={PATH}>Reset</Link>
                </Button>
              ) : null}
            </div>
          </form>
          {filters.errorCode ? (
            <p className="text-muted-foreground mt-3 text-sm">
              Showing error <code className="text-foreground">{filters.errorCode}</code> only.{" "}
              <Link
                href={`${PATH}?${new URLSearchParams(
                  Object.entries({
                    q: filters.q,
                    status: filters.status,
                    from: dayValue(filters.from),
                    to: dayValue(filters.to),
                  }).filter((e): e is [string, string] => Boolean(e[1])),
                ).toString()}`}
                className="underline underline-offset-4"
              >
                Clear
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState title={filtered ? "No messages match these filters" : "No messages yet"}>
          {filtered ? (
            <Link href={PATH} className="underline underline-offset-4">
              Reset filters
            </Link>
          ) : (
            <>
              <Link href="/dashboard#send-test" className="underline underline-offset-4">
                Send a test email
              </Link>{" "}
              or call the API.
            </>
          )}
        </EmptyState>
      ) : (
        <Card className="py-2">
          <CardContent className="px-2 sm:px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="hidden md:table-cell">Error / SES message ID</TableHead>
                  <TableHead className="w-24 text-right">Accepted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => {
                  const recipients = Array.isArray(row.recipients) ? (row.recipients as string[]) : [];
                  return (
                    <TableRow key={row.id} className="relative">
                      <TableCell className="align-top">
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="max-w-0 align-top whitespace-normal">
                        {/* The whole row is the link, via the stretched ::after. */}
                        <Link
                          href={`${PATH}/${row.id}`}
                          className="block truncate font-medium after:absolute after:inset-0 hover:underline"
                        >
                          {row.subject}
                        </Link>
                        <p className="text-muted-foreground truncate text-xs">
                          to {recipients[0] ?? "—"}
                          {recipients.length > 1 ? ` +${recipients.length - 1}` : ""} · from{" "}
                          {row.fromAddress}
                          {row.templateId ? (
                            <> · {templateName.get(row.templateId) ?? "template"} v{row.templateVersion}</>
                          ) : null}
                        </p>
                        {row.errorCode ? (
                          <p className="truncate font-mono text-xs text-red-700 dark:text-red-400 md:hidden">
                            {row.errorCode}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden max-w-0 align-top font-mono text-xs md:table-cell">
                        <span className="block truncate">
                          {row.errorCode ? (
                            <span className="text-red-700 dark:text-red-400">{row.errorCode}</span>
                          ) : (
                            (row.messageId ?? "—")
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right align-top text-xs">
                        <Time date={row.queuedAt} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Pagination
        path={PATH}
        params={params}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
