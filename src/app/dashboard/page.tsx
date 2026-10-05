import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, OctagonAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectEventsButton } from "@/components/dashboard/setup-actions";
import { SetupGuide } from "@/components/dashboard/setup-guide";
import { ProductionAccessCard } from "@/components/dashboard/production-access-card";
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
import { cn } from "@/lib/utils";
import { hintFor } from "@/lib/dashboard/error-hints";
import { describeAccess, inSandbox } from "@/lib/sandbox/access-state";
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
import { refreshPendingEmailIdentities } from "@/server/email-identities";
import { getActiveEnvironment } from "@/server/environment";
import { getSandboxRequest } from "@/server/sandbox";
import { withFreshSandboxStatus } from "@/server/sandbox-refresh";
import { WEBHOOK_PATH, webhookEndpoint } from "@/server/public-url";
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
        <span className="flex items-center gap-1 text-red-700 dark:text-red-400">
          <OctagonAlert className="size-3.5" aria-hidden /> Above review threshold · {limits}
        </span>
      );
    case "warning":
      return (
        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5" aria-hidden /> Above warning threshold · {limits}
        </span>
      );
    case "early":
      // Neutral, not a warning: the number is real but too few sends back it.
      return <span>Too few sends to judge yet · {limits}</span>;
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

  const [stats, series, queue, credentials, domains, keys, topics, recent, errors, endpoint, emails] =
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
      webhookEndpoint(),
      refreshPendingEmailIdentities(tenant.id),
    ]);

  // Phase 9: re-ask AWS about the sandbox when the snapshot is stale (cooldown,
  // timeout and failures handled inside), so "waiting for AWS" is current.
  const credential = await withFreshSandboxStatus(
    tenant.id,
    environment,
    credentials.find((c) => c.environment === environment && c.active),
  );
  const envDomains = domains.filter((d) => d.environment === environment);
  const envEmails = emails.filter((e) => e.environment === environment);
  // A verified domain or a verified address: either lets SES send.
  const verifiedDomains =
    envDomains.filter((d) => d.status === "verified").length +
    envEmails.filter((e) => e.status === "verified").length;
  const now = Date.now();
  const activeKeys = keys.filter(
    (k) =>
      k.environment === environment &&
      !k.revokedAt &&
      (!k.expiresAt || k.expiresAt.getTime() > now),
  ).length;
  // SNS registration has no environment column for hand-registered topics
  // (SRS schema), so a confirmed one counts for both environments.
  const eventsConnected = topics.some(
    (t) => t.status === "confirmed" || (t.managed && t.environment === environment),
  );

  // Phase 8: until this environment has sent something, the Overview is the
  // setup guide — monitoring an empty account only looks broken. Once it has
  // history, the dashboard stays, and anything unfinished is flagged below.
  if (recent.total === 0) {
    return (
      <SetupGuide
        credential={credential}
        domains={envDomains}
        emails={envEmails}
        hasKey={activeKeys > 0}
        eventsConnected={eventsConnected}
        appUrl={endpoint.url.slice(0, -WEBHOOK_PATH.length)}
        local={endpoint.local}
        email={tenant.email}
      />
    );
  }

  const sandboxRow = credential ? await getSandboxRequest(tenant.id, environment) : null;
  const access = credential
    ? describeAccess(credential.account, { connected: true, prepared: Boolean(sandboxRow?.reviewedAt) })
    : null;

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
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {credential ? (
                <>
                  Sending via {credential.awsRegion}
                  {credential.account && !credential.account.productionAccessEnabled
                    ? " · SES sandbox"
                    : ""}
                </>
              ) : (
                "No AWS credential configured yet"
              )}
            </span>
          </span>
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

      {access && inSandbox(access.state) ? <ProductionAccessCard view={access} compact /> : null}

      {!credential || verifiedDomains === 0 || activeKeys === 0 ? (
        <Alert>
          <AlertTriangle aria-hidden />
          <AlertTitle>Setup isn&apos;t finished</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {!credential ? (
                <li>
                  No active AWS credential, so new sends will fail.{" "}
                  <Link href="/dashboard/aws">Connect AWS</Link>
                </li>
              ) : null}
              {verifiedDomains === 0 ? (
                <li>
                  No verified domain or email address, so SES will reject mail.{" "}
                  <Link href="/dashboard/domains">Add a domain</Link>
                </li>
              ) : null}
              {activeKeys === 0 ? (
                <li>
                  No active API key for your app.{" "}
                  <Link href="/dashboard/api-keys">Create one</Link>
                </li>
              ) : null}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {eventsConnected ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Track deliveries and bounces</CardTitle>
            <CardDescription>
              This is normally set up when you connect AWS, but it isn&apos;t yet, so emails stay on
              &ldquo;sent&rdquo;. One click sets up Amazon SNS in your account, so each email&apos;s outcome
              shows up here and bounced addresses stop being sent to.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectEventsButton local={endpoint.local} />
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="stats-heading" className="space-y-4">
        <h2 id="stats-heading" className="sr-only">
          Delivery statistics
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label="Accepted"
            value={formatCount(stats.total)}
            hint={days === 1 ? "last 24 hours" : `last ${days} days`}
            href={activityHref()}
          />
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
            — <ReputationNote kind="bounce" level={reputationLevel("bounce", stats.bounceRate, { sample: stats.reachedSes, events: stats.bounced })} />
          </p>
          <p>
            <span className="text-foreground font-medium">
              Complaint rate {formatRate(stats.complaintRate)}
            </span>{" "}
            — <ReputationNote kind="complaint" level={reputationLevel("complaint", stats.complaintRate, { sample: stats.reachedSes, events: stats.complained })} />
          </p>
        </div>

        {eventsConnected && stats.reachedSes > 0 && stats.withOutcome === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm">
            {formatCount(stats.sent)} messages reached SES, but no delivery outcomes have
            arrived yet. They usually take a few seconds —{" "}
            <Link href="/dashboard/webhooks" className="underline underline-offset-4">
              check Webhooks
            </Link>{" "}
            if they don&apos;t show up.
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
            <CardDescription>Live.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!queue.configured || !queue.reachable ? (
              <Alert variant="destructive">
                <OctagonAlert aria-hidden />
                <AlertTitle>{queue.configured ? "Queue unreachable" : "No queue configured"}</AlertTitle>
                <AlertDescription>Sends will be refused with a 503 until this is fixed.</AlertDescription>
              </Alert>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["Waiting", queue.depth?.waiting],
                      ["Active", queue.depth?.active],
                      ["Delayed", queue.depth?.delayed],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-md border px-3 py-2">
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{value ?? 0}</dd>
                    </div>
                  ))}
                  <div className="rounded-md border px-3 py-2">
                    <dt className="text-muted-foreground text-xs">Dead-lettered</dt>
                    <dd
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        (queue.depth?.failed ?? 0) > 0 && "text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {queue.depth?.failed ?? 0}
                    </dd>
                  </div>
                </dl>
                <p className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                  <span>
                    Exhausted retries or permanently rejected, retained 14 days
                    {(queue.depth?.failed ?? 0) > 0 ? "." : " — none right now."}
                  </span>
                  {(queue.depth?.failed ?? 0) > 0 ? (
                    <Link
                      href="/dashboard/health#dead-letter"
                      className="text-primary shrink-0 font-medium hover:underline"
                    >
                      View queue →
                    </Link>
                  ) : null}
                </p>
                <p className="flex items-center gap-2">
                  {queue.workers.some((w) => w.healthy) ? (
                    <>
                      <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
                      {queue.workers.filter((w) => w.healthy).length} worker(s) healthy
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="size-4 text-amber-700 dark:text-amber-400" aria-hidden />
                      No worker running — messages will wait in the queue
                    </>
                  )}
                </p>
              </>
            )}
            <Link href="/dashboard/health" className="text-sm underline underline-offset-4">
              Sending status →
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
              <EmptyState title="Nothing sent yet">
                <p className="mb-3">
                  Send a test email below, or call <code>POST /api/v1/send</code> from your code.
                </p>
                <Button asChild size="sm" variant="secondary">
                  <a href="#send-test">
                    Send your first message
                    <ArrowRight className="size-3.5" aria-hidden />
                  </a>
                </Button>
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
          <TestSendForm />
          <details>
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm">
              The same request from code
            </summary>
            <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-3 text-xs">
              {`curl -X POST ${"$"}OPS_URL/api/v1/send \\
  -H "Authorization: Bearer sk_live_…" \\
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
