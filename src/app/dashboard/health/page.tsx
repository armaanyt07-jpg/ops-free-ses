import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AMBER, GREEN } from "@/components/dashboard/badge-tones";
import { cn } from "@/lib/utils";
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
import { PageHeader, Time } from "@/components/dashboard/primitives";
import { getQueueHealth } from "@/server/queue-health";
import { webhookStats } from "@/server/sns-events";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="text-muted-foreground text-xs">
          {hint}
        </CardContent>
      ) : null}
    </Card>
  );
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default async function HealthPage() {
  // Queue health is infrastructure-wide, not tenant-scoped, but the page is
  // still behind authentication.
  const tenant = await requireTenant();
  const [health, webhooks] = await Promise.all([
    getQueueHealth(tenant.id),
    // Webhook figures, by contrast, are this tenant's own events.
    webhookStats(tenant.id),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Queue & health"
        description="Queue depth, retries, dead-lettered jobs, worker heartbeats and webhook lag."
      />

      {!health.configured ? (
        <Alert>
          <AlertTitle>No queue backend configured</AlertTitle>
          <AlertDescription>
            <code>REDIS_URL</code> is not set, so sends cannot be accepted.
          </AlertDescription>
        </Alert>
      ) : null}

      {health.configured && !health.reachable ? (
        <Alert variant="destructive">
          <AlertTitle>Queue unreachable</AlertTitle>
          <AlertDescription>{health.error}</AlertDescription>
        </Alert>
      ) : null}

      {health.depth ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat
              label="Waiting"
              value={health.depth.waiting}
              hint="ready to process"
            />
            <Stat
              label="Active"
              value={health.depth.active}
              hint="in flight now"
            />
            <Stat
              label="Delayed"
              value={health.depth.delayed}
              hint="retry or rate-limit backoff"
            />
            <Stat
              label="Dead-lettered"
              value={health.depth.failed}
              hint="platform-wide"
            />
            <Stat
              label="Completed"
              value={health.depth.completed}
              hint="retained 24h"
            />
          </div>

          {health.depth.paused ? (
            <Alert variant="destructive">
              <AlertTitle>Queue is paused</AlertTitle>
              <AlertDescription>
                Jobs are accepted but nothing is being processed.
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Workers</CardTitle>
          <CardDescription>
            Each worker refreshes a heartbeat every 10s. A worker that dies
            stops refreshing and its record expires on its own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {health.workers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No workers are reporting. Start one with{" "}
              <code>npm run worker</code> — without it, accepted jobs stay
              queued.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>PID</TableHead>
                  <TableHead>Concurrency</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Last beat</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.workers.map((w) => (
                  <TableRow key={w.workerId}>
                    <TableCell className="font-mono text-xs">
                      {w.workerId}
                    </TableCell>
                    <TableCell>{w.host}</TableCell>
                    <TableCell className="tabular-nums">{w.pid}</TableCell>
                    <TableCell className="tabular-nums">
                      {w.concurrency}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {w.processed}
                    </TableCell>
                    <TableCell className="tabular-nums">{w.failed}</TableCell>
                    <TableCell className="tabular-nums">
                      {Math.round(w.staleMs / 1000)}s ago
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={cn(w.healthy ? GREEN : AMBER)}>
                        {w.healthy ? "healthy" : "stale"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SNS webhooks</CardTitle>
          <CardDescription>
            Lag is the time from SES recording an event to this platform
            receiving it, over your last 24 hours of events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Last event"
              value={
                webhooks.lastReceivedAt
                  ? `${formatAge(Date.now() - webhooks.lastReceivedAt.getTime())} ago`
                  : "never"
              }
            />
            <Stat label="Events (24h)" value={webhooks.last24h} />
            <Stat
              label="Median lag"
              value={
                webhooks.medianLagMs === null
                  ? "—"
                  : formatAge(webhooks.medianLagMs)
              }
              hint={
                webhooks.maxLagMs === null
                  ? undefined
                  : `max ${formatAge(webhooks.maxLagMs)}`
              }
            />
            <Stat
              label="Unmatched (24h)"
              value={webhooks.unmatched24h}
              hint="SES message not sent by this platform"
            />
          </div>
        </CardContent>
      </Card>

      <Card id="dead-letter" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>Dead letter</CardTitle>
          <CardDescription>
            Your jobs that exhausted their retries or were permanently
            rejected, across both environments. They are retained in the
            queue&apos;s failed set for 14 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {health.deadLetter.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing dead-lettered.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Failed at</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.deadLetter.map((entry) => (
                  <TableRow key={entry.jobId}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {entry.failedAt ? <Time date={entry.failedAt} /> : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.logId ? (
                        <Link
                          href={`/dashboard/activity/${entry.logId}`}
                          className="underline underline-offset-4"
                        >
                          {entry.jobId}
                        </Link>
                      ) : (
                        entry.jobId
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {entry.attemptsMade}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-96 truncate text-xs">
                      {entry.failedReason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
