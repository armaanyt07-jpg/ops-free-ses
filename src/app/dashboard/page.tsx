import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, OctagonAlert } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TestSendForm } from "@/components/dashboard/test-send-form";
import { VolumeChart } from "@/components/dashboard/volume-chart";
import {
  EmptyState,
  PageHeader,
  SegmentedLinks,
  StatTile,
  Time,
} from "@/components/dashboard/primitives";
import { formatCount, formatRate } from "@/lib/dashboard/format";
import { hintFor } from "@/lib/dashboard/error-hints";
import { dayValue, parseWindow, type SearchParams } from "@/lib/dashboard/params";
import { reputationLevel, THRESHOLDS, type ReputationLevel } from "@/lib/dashboard/reputation";
import {
  deliveryStats,
  errorGroups,
  searchActivity,
  since,
  volumeSeries,
} from "@/server/activity";
import { listApiKeys } from "@/server/api-keys";
import { listCredentials } from "@/server/credentials";
import { listDomains } from "@/server/domains";
import { getActiveEnvironment } from "@/server/environment";
import { getQueueHealth } from "@/server/queue-health";
import { listTopics } from "@/server/sns-topics";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

function ReputationNote({ level, kind }: { level: ReputationLevel; kind: "bounce" | "complaint" }) {
  const t = THRESHOLDS[kind];
  const limits = `SES warns at ${formatRate(t.warning)}, reviews at ${formatRate(t.review)}`;
  // Status colour never carries meaning alone: icon + words, always.
  switch (level) {
    case "review":
      return (
        <span className="flex items-center gap-1 text-red-700">
          <OctagonAlert className="size-3.5" aria-hidden /> Above review threshold · {limits}
        </span>
      );
    case "warning":
      return (
        <span className="flex items-center gap-1 text-amber-700">
          <AlertTriangle className="size-3.5" aria-hidden /> Above warning threshold · {limits}
        </span>
      );
    case "healthy":
      return <span>Healthy · {limits}</span>;
    case "none":
      return <span>No sends yet</span>;
  }
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);
  const days = parseWindow(params);

  const [stats, series, queue, credentials, domains, keys, topics, recent, errors] =
    await Promise.all([
      deliveryStats(tenant.id, environment, days),
      volumeSeries(tenant.id, environment, days),
      getQueueHealth(tenant.id),
      listCredentials(tenant.id),
      listDomains(tenant.id),
      listApiKeys(tenant.id),
      listTopics(tenant.id),
      searchActivity(tenant.id, environment, {}, 1, 8),
      errorGroups(tenant.id, environment, days),
    ]);

  const credential = credentials.find((c) => c.environment === environment && c.active);
  const verifiedDomains = domains.filter(
    (d) => d.environment === environment && d.status === "verified",
  ).length;
  const now = Date.now();
  const activeKeys = keys.filter(
    (k) =>
      k.environment === environment &&
      !k.revokedAt &&
      (!k.expiresAt || k.expiresAt.getTime() > now),
  ).length;
  const confirmedTopic = topics.some((t) => t.status === "confirmed");

  const steps = [
    {
      done: Boolean(credential),
      label: `Add an AWS credential for ${environment}`,
      href: "/dashboard/aws",
    },
    {
      done: verifiedDomains > 0,
      label: "Verify a sending domain",
      href: "/dashboard/domains",
    },
    {
      done: activeKeys > 0,
      label: `Create a ${environment} API key`,
      href: "/dashboard/api-keys",
    },
    {
      done: confirmedTopic,
      label: "Connect SNS for delivery, bounce and complaint events",
      href: "/dashboard/webhooks",
    },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  // Tiles open Activity filtered to the same window, so the list a tile opens
  // is the list the tile counted (to day granularity).
  const fromDay = dayValue(since(days));
  const activityHref = (status?: string) =>
    `/dashboard/activity?${status ? `status=${status}&` : ""}from=${fromDay}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={
          <>
            Sending in <strong className="text-foreground">{environment}</strong>
            {credential ? (
              <>
                {" "}
                via {credential.awsRegion}
                {credential.account && !credential.account.productionAccessEnabled
                  ? " · SES sandbox"
                  : ""}
              </>
            ) : null}
            .
          </>
        }
        actions={
          <SegmentedLinks
            path="/dashboard"
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

      {remaining > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Finish setting up {environment}</CardTitle>
            <CardDescription>
              {steps.length - remaining} of {steps.length} done.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2 sm:grid-cols-2">
              {steps.map((step) => (
                <li key={step.label}>
                  <Link
                    href={step.href}
                    className="hover:bg-muted/60 flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm"
                  >
                    {step.done ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-700" aria-label="Done" />
                    ) : (
                      <Circle className="text-muted-foreground size-4 shrink-0" aria-label="To do" />
                    )}
                    <span className={step.done ? "text-muted-foreground line-through" : ""}>
                      {step.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="stats-heading" className="space-y-4">
        <h2 id="stats-heading" className="sr-only">
          Delivery statistics
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Accepted" value={formatCount(stats.total)} href={activityHref()} />
          <StatTile
            label="Delivered"
            value={formatCount(stats.delivered)}
            hint={stats.deliveryRate === null ? "no outcomes yet" : `${formatRate(stats.deliveryRate)} of outcomes`}
            href={activityHref("delivered")}
          />
          <StatTile
            label="Bounced"
            value={formatCount(stats.bounced)}
            hint={formatRate(stats.bounceRate)}
            href={activityHref("bounced")}
          />
          <StatTile
            label="Complained"
            value={formatCount(stats.complained)}
            hint={formatRate(stats.complaintRate)}
            href={activityHref("complained")}
          />
          <StatTile
            label="Failed"
            value={formatCount(stats.failed)}
            hint="never reached SES"
            href={activityHref("failed")}
          />
          <StatTile
            label="Suppressed"
            value={formatCount(stats.suppressed)}
            hint="blocked before send"
            href={activityHref("suppressed")}
          />
        </div>

        <div className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
          <p>
            <span className="text-foreground font-medium">Bounce rate {formatRate(stats.bounceRate)}</span>{" "}
            — <ReputationNote kind="bounce" level={reputationLevel("bounce", stats.bounceRate)} />
          </p>
          <p>
            <span className="text-foreground font-medium">
              Complaint rate {formatRate(stats.complaintRate)}
            </span>{" "}
            — <ReputationNote kind="complaint" level={reputationLevel("complaint", stats.complaintRate)} />
          </p>
        </div>

        {stats.reachedSes > 0 && stats.withOutcome === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm">
            {formatCount(stats.sent)} messages reached SES, but no delivery outcomes have
            arrived. Outcomes come from SNS —{" "}
            <Link href="/dashboard/webhooks" className="underline underline-offset-4">
              connect a topic
            </Link>{" "}
            to see deliveries, bounces and complaints.
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Volume by outcome</CardTitle>
            <CardDescription>
              {days === 1 ? "Hourly, last 24 hours" : `Daily, last ${days} days`} · UTC ·
              by the time each message was accepted
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VolumeChart
              hourly={days === 1}
              points={series.map((b) => ({
                start: b.start.toISOString(),
                delivered: b.delivered,
                pending: b.pending,
                problems: b.problems,
                notSent: b.notSent,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue</CardTitle>
            <CardDescription>Live, across all environments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!queue.configured || !queue.reachable ? (
              <p className="flex items-center gap-2 text-red-700">
                <OctagonAlert className="size-4" aria-hidden />
                {queue.configured ? "Queue unreachable" : "No queue configured"} — sends will
                be refused with 503.
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["Waiting", queue.depth?.waiting],
                      ["Active", queue.depth?.active],
                      ["Delayed", queue.depth?.delayed],
                      ["Dead-lettered", queue.depth?.failed],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-md border px-3 py-2">
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="text-lg font-semibold">{value ?? 0}</dd>
                    </div>
                  ))}
                </dl>
                <p className="flex items-center gap-2">
                  {queue.workers.some((w) => w.healthy) ? (
                    <>
                      <CheckCircle2 className="size-4 text-emerald-700" aria-hidden />
                      {queue.workers.filter((w) => w.healthy).length} worker(s) healthy
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="size-4 text-amber-700" aria-hidden />
                      No worker running — messages will wait in the queue
                    </>
                  )}
                </p>
              </>
            )}
            <Link href="/dashboard/health" className="text-sm underline underline-offset-4">
              Queue &amp; health →
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.rows.length === 0 ? (
              <EmptyState title={`Nothing sent in ${environment} yet`}>
                Send a test below, or call <code>POST /api/v1/send</code>.
              </EmptyState>
            ) : (
              <ul className="divide-y">
                {recent.rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/dashboard/activity/${row.id}`}
                      className="hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 text-sm"
                    >
                      <StatusBadge status={row.status} />
                      <span className="min-w-0 flex-1 truncate">
                        {row.subject}
                        <span className="text-muted-foreground">
                          {" "}
                          → {(row.recipients as string[]).join(", ")}
                        </span>
                      </span>
                      <span className="text-muted-foreground text-xs">
                        <Time date={row.queuedAt} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/dashboard/activity" className="mt-3 inline-block text-sm underline underline-offset-4">
              All activity →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top errors</CardTitle>
            <CardDescription>Failed and suppressed messages, by cause.</CardDescription>
          </CardHeader>
          <CardContent>
            {errors.length === 0 ? (
              <EmptyState title="No failures in this window" />
            ) : (
              <ul className="divide-y">
                {errors.slice(0, 4).map((group) => (
                  <li key={group.errorCode} className="flex items-start gap-3 py-2.5 text-sm">
                    <span className="bg-muted min-w-10 rounded-md px-2 py-0.5 text-center font-medium tabular-nums">
                      {formatCount(group.count)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/dashboard/activity?error=${encodeURIComponent(group.errorCode)}`}
                        className="font-medium hover:underline"
                      >
                        {hintFor(group.errorCode).title}
                      </Link>
                      <p className="text-muted-foreground font-mono text-xs">{group.errorCode}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/dashboard/errors" className="mt-3 inline-block text-sm underline underline-offset-4">
              Error tracking →
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card id="send-test">
        <CardHeader>
          <CardTitle>Send a test email</CardTitle>
          <CardDescription>
            A real send through the same pipeline as the API: suppression check, queue,
            worker, SES.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <TestSendForm environment={environment} />
          <details>
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm">
              The same request from code
            </summary>
            <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-3 text-xs">
              {`curl -X POST ${"$"}OPS_URL/api/v1/send \\
  -H "Authorization: Bearer ${environment === "production" ? "sk_live_…" : "sk_test_…"}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "from": "you@your-domain.com",
    "to": ["success@simulator.amazonses.com"],
    "subject": "Hello",
    "text": "Sent through Ops-Free SES"
  }'`}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
