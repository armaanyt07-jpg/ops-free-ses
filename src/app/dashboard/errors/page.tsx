import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  SegmentedLinks,
  StatTile,
  Time,
} from "@/components/dashboard/primitives";
import { formatCount } from "@/lib/dashboard/format";
import { hasSpecificHint, hintFor } from "@/lib/dashboard/error-hints";
import { dayValue, parseWindow, type SearchParams } from "@/lib/dashboard/params";
import { bounceGroups, deliveryStats, errorGroups, since } from "@/server/activity";
import { getActiveEnvironment } from "@/server/environment";
import { getQueueHealth } from "@/server/queue-health";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

/**
 * Error tracking — Phase 4 scope.
 *
 * Failures grouped by cause rather than listed one by one: fifty messages
 * failing with the same missing credential is one problem, and should read as
 * one. Each group says what the code means and links to the page that fixes
 * it, and to the exact messages affected.
 */
export default async function ErrorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);
  const days = parseWindow(params);
  const fromDay = dayValue(since(days));

  const [groups, bounces, stats, queue] = await Promise.all([
    errorGroups(tenant.id, environment, days),
    bounceGroups(tenant.id, environment, days),
    deliveryStats(tenant.id, environment, days),
    getQueueHealth(tenant.id),
  ]);

  const deadLetterHere = queue.deadLetter.length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Errors"
        description="What went wrong, grouped by cause, with what to do about each."
        actions={
          <SegmentedLinks
            path="/dashboard/errors"
            params={params}
            paramKey="window"
            current={String(days)}
            options={[
              { value: "1", label: "24h" },
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
            ]}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Failed"
          value={formatCount(stats.failed)}
          hint="did not reach SES"
          href={`/dashboard/activity?status=failed&from=${fromDay}`}
        />
        <StatTile
          label="Suppressed"
          value={formatCount(stats.suppressed)}
          hint="blocked by the worker"
          href={`/dashboard/activity?status=suppressed&from=${fromDay}`}
        />
        <StatTile
          label="Bounced"
          value={formatCount(stats.bounced)}
          href={`/dashboard/activity?status=bounced&from=${fromDay}`}
        />
        <StatTile
          label="Dead-lettered (yours)"
          value={formatCount(deadLetterHere)}
          hint={deadLetterHere >= 20 ? "20+ · most recent shown" : "both environments"}
          href="/dashboard/health"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Failures by cause</CardTitle>
          <CardDescription>
            Messages that ended failed or suppressed. Requests the API refused outright (400,
            401, 403 suppressed) never became messages and are not counted here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <EmptyState title={"No failures in this window"} />
          ) : (
            <ul className="divide-y">
              {groups.map((g) => {
                const hint = hintFor(g.errorCode);
                return (
                  <li key={g.errorCode} className="grid gap-3 py-4 sm:grid-cols-[4rem_1fr_auto]">
                    <div className="text-2xl font-semibold tabular-nums">{formatCount(g.count)}</div>
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">
                        {hint.title}{" "}
                        <code className="text-muted-foreground text-xs font-normal">{g.errorCode}</code>
                      </p>
                      <p className="text-muted-foreground text-sm">{hint.explanation}</p>
                      {g.sampleMessage && !hasSpecificHint(g.errorCode) ? (
                        <p className="text-muted-foreground font-mono text-xs break-words">
                          e.g. {g.sampleMessage}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground text-xs">
                        Last seen <Time date={g.lastSeen} />
                      </p>
                    </div>
                    <div className="flex flex-wrap items-start gap-3 text-sm sm:flex-col sm:items-end">
                      {hint.action ? (
                        <Link href={hint.action.href} className="font-medium underline underline-offset-4">
                          {hint.action.label}
                        </Link>
                      ) : null}
                      <Link
                        href={`/dashboard/activity?error=${encodeURIComponent(g.errorCode)}&from=${fromDay}`}
                        className="text-muted-foreground underline underline-offset-4"
                      >
                        View {formatCount(g.count)} message{g.count === 1 ? "" : "s"}
                      </Link>
                      <Link
                        href={`/dashboard/activity/${g.sampleLogId}`}
                        className="text-muted-foreground underline underline-offset-4"
                      >
                        Latest example
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bounces &amp; complaints by type</CardTitle>
            <CardDescription>
              Permanent bounces point at list quality; transient ones usually clear up on
              their own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bounces.length === 0 ? (
              <EmptyState title="None recorded">
                These arrive through SNS —{" "}
                <Link href="/dashboard/webhooks" className="underline underline-offset-4">
                  webhook setup
                </Link>
                .
              </EmptyState>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bounces.map((b) => (
                    <TableRow key={`${b.eventType}-${b.kind}-${b.subType}`}>
                      <TableCell>{b.eventType}</TableCell>
                      <TableCell>
                        {b.kind}
                        {b.subType ? <span className="text-muted-foreground"> / {b.subType}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(b.count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently dead-lettered</CardTitle>
            <CardDescription>
              Your jobs that exhausted retries or were permanently rejected, in either
              environment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {deadLetterHere === 0 ? (
              <EmptyState title="Nothing dead-lettered" />
            ) : (
              <ul className="divide-y text-sm">
                {queue.deadLetter.slice(0, 6).map((d) => (
                  <li key={d.jobId} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={d.failedReason}>
                      {d.failedReason}
                    </span>
                    {d.logId ? (
                      <Link
                        href={`/dashboard/activity/${d.logId}`}
                        className="shrink-0 underline underline-offset-4"
                      >
                        Open
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
