import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { GREEN } from "@/components/dashboard/badge-tones";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Fields, PageHeader, Time } from "@/components/dashboard/primitives";
import { formatDateTime } from "@/lib/dashboard/format";
import { hintFor } from "@/lib/dashboard/error-hints";
import type { RecipientState } from "@/lib/ses/delivery-state";
import { getMessageDetail } from "@/server/activity";
import { getSendJobState } from "@/server/queue-health";
import { getTemplate } from "@/server/templates";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

/**
 * Message detail — Phase 4 scope. Everything known about one message: its
 * lifecycle, each recipient's outcome, the SES identifiers, the queue job and,
 * for a failure, what the error means and what to do.
 *
 * The body is not shown. It is never stored in the database (SRS §9: no full
 * message bodies), and only lives in the queue job until delivery.
 */
interface ProviderEvent {
  retryable?: boolean;
  attempt?: number;
  nextAttemptAt?: string | null;
  terminalReason?: string;
  suppressed?: string[];
  recipients?: Record<string, RecipientState>;
}

const OUTCOME_STYLE: Record<string, { variant: "destructive" | "secondary"; className?: string }> = {
  delivered: { variant: "secondary", className: GREEN },
  bounced: { variant: "destructive" },
  complained: { variant: "destructive" },
};

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>;
}

export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const detail = await getMessageDetail(tenant.id, id);
  if (!detail) notFound();

  const { log, events } = detail;
  const [job, template] = await Promise.all([
    getSendJobState(tenant.id, log.id),
    log.templateId ? getTemplate(tenant.id, log.templateId) : Promise.resolve(null),
  ]);
  const templateName = template?.name;
  const provider = (log.providerEvent ?? {}) as ProviderEvent;
  const recipients = Array.isArray(log.recipients) ? (log.recipients as string[]) : [];
  const outcomes = provider.recipients ?? {};
  const hint = log.errorCode ? hintFor(log.errorCode) : null;

  // The lifecycle, in order. Each entry is a fact from the log or an event.
  const timeline: Array<{ at: Date; label: string; detail?: string | undefined }> = [
    { at: log.queuedAt, label: "Accepted and queued" },
  ];
  if (log.sentAt) {
    timeline.push({ at: log.sentAt, label: "Accepted by SES", detail: log.messageId ?? undefined });
  }
  for (const e of events) {
    const payload = (e.payload ?? {}) as { recipients?: unknown[]; bounceType?: string };
    const who = Array.isArray(payload.recipients)
      ? payload.recipients
          .map((r) => (typeof r === "string" ? r : (r as { email?: string }).email))
          .filter(Boolean)
          .join(", ")
      : undefined;
    timeline.push({
      at: e.eventAt ?? e.receivedAt,
      label: `${e.eventType ?? e.messageType}${payload.bounceType ? ` (${payload.bounceType})` : ""}`,
      detail: who,
    });
  }
  if (log.completedAt && (log.status === "failed" || log.status === "suppressed")) {
    timeline.push({
      at: log.completedAt,
      label: log.status === "failed" ? "Failed" : "Not sent — suppressed",
      detail: log.errorCode ?? undefined,
    });
  }
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  const tags = log.tags && typeof log.tags === "object" ? Object.entries(log.tags as Record<string, string>) : [];

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/activity"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden /> Activity
      </Link>

      <PageHeader
        title={log.subject}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={log.status} />
            <Badge variant="outline">{log.environment}</Badge>
            <span>
              from {log.fromAddress} · <Time date={log.queuedAt} />
            </span>
          </span>
        }
      />

      {hint ? (
        <Alert variant={log.status === "suppressed" ? "default" : "destructive"}>
          <AlertTitle>{hint.title}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{hint.explanation}</p>
            {log.errorMessage ? (
              <p className="font-mono text-xs break-words">
                {log.errorCode}: {log.errorMessage}
              </p>
            ) : null}
            {hint.action ? (
              <Link href={hint.action.href} className="font-medium underline underline-offset-4">
                {hint.action.label} →
              </Link>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {log.status === "queued" && provider.retryable && provider.nextAttemptAt ? (
        <Alert>
          <AlertTitle>Retrying</AlertTitle>
          <AlertDescription>
            Attempt {provider.attempt} failed with <code>{log.errorCode}</code>. Next attempt{" "}
            <Time date={new Date(provider.nextAttemptAt)} />.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recipients</CardTitle>
            <CardDescription>
              Outcome per recipient, as SES reported it through SNS.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="hidden sm:table-cell">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((r) => {
                  const o = outcomes[r.toLowerCase()];
                  const suppressed = provider.suppressed?.includes(r.toLowerCase());
                  return (
                    <TableRow key={r}>
                      <TableCell className="font-mono text-xs break-all whitespace-normal">{r}</TableCell>
                      <TableCell>
                        {o ? (
                          <Badge
                            variant={OUTCOME_STYLE[o.status]?.variant ?? "secondary"}
                            className={cn(OUTCOME_STYLE[o.status]?.className)}
                          >
                            {o.status}
                          </Badge>
                        ) : suppressed ? (
                          <Badge variant="outline">suppressed</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {log.status === "sent" ? "awaiting outcome" : "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden max-w-72 text-xs whitespace-normal sm:table-cell">
                        {o?.status === "bounced"
                          ? `${o.bounceType ?? ""}${o.bounceSubType ? ` / ${o.bounceSubType}` : ""}${o.diagnostic ? ` — ${o.diagnostic}` : ""}`
                          : o?.status === "complained"
                            ? (o.feedbackType ?? "complaint")
                            : o?.at
                              ? formatDateTime(new Date(o.at))
                              : ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {log.status === "sent" && Object.keys(outcomes).length === 0 ? (
              <p className="text-muted-foreground mt-3 text-xs">
                SES accepted this message. Delivery outcomes arrive via SNS —{" "}
                <Link href="/dashboard/webhooks" className="underline underline-offset-4">
                  connect a topic
                </Link>{" "}
                if none ever appear.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l pl-5">
              {timeline.map((t, i) => (
                <li key={`${t.label}-${i}`} className="relative">
                  <span
                    aria-hidden
                    className="bg-foreground absolute top-1.5 -left-[25px] size-2 rounded-full ring-4 ring-background"
                  />
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-muted-foreground text-xs" title={formatDateTime(t.at)}>
                    {formatDateTime(t.at)}
                  </p>
                  {t.detail ? (
                    <p className="text-muted-foreground mt-0.5 font-mono text-xs break-all">{t.detail}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identifiers</CardTitle>
          </CardHeader>
          <CardContent>
            <Fields
              items={[
                ["Log ID", <Mono key="id">{log.id}</Mono>],
                ["SES message ID", log.messageId ? <Mono key="m">{log.messageId}</Mono> : "—"],
                ["SES request ID", log.sesRequestId ? <Mono key="r">{log.sesRequestId}</Mono> : "—"],
                [
                  "Template",
                  log.templateId ? (
                    <Link
                      key="tpl"
                      href={`/dashboard/templates/${log.templateId}?v=${log.templateVersion}`}
                      className="underline underline-offset-4"
                    >
                      {templateName ?? "template"} v{log.templateVersion}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                ["Idempotency key", log.idempotencyKey ? <Mono key="k">{log.idempotencyKey}</Mono> : "—"],
                ["Completed", log.completedAt ? formatDateTime(log.completedAt) : "not yet"],
                [
                  "Tags",
                  tags.length === 0 ? (
                    "—"
                  ) : (
                    <span key="t" className="flex flex-wrap gap-1">
                      {tags.map(([k, v]) => (
                        <Badge key={k} variant="secondary" className="font-mono">
                          {k}={v}
                        </Badge>
                      ))}
                    </span>
                  ),
                ],
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue job</CardTitle>
            <CardDescription>
              The BullMQ job for this message. Completed jobs are pruned after 24 hours; the
              log above stays the record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {job === "unavailable" ? (
              <p className="text-muted-foreground text-sm">The queue could not be reached.</p>
            ) : job === null ? (
              <p className="text-muted-foreground text-sm">
                No job in the queue {log.completedAt || log.sentAt ? "(already pruned)" : ""}.
              </p>
            ) : (
              <Fields
                items={[
                  ["State", <Badge key="s" variant="outline">{job.state}</Badge>],
                  ["Attempts", `${job.attemptsMade} of ${job.maxAttempts}`],
                  ["Next run", job.runsAt ? <Time key="n" date={job.runsAt} /> : "—"],
                  ["Last failure", job.failedReason ? <Mono key="f">{job.failedReason}</Mono> : "—"],
                ]}
              />
            )}
            {provider.terminalReason ? (
              <p className="text-muted-foreground mt-3 text-xs">
                Terminal reason: <code>{provider.terminalReason}</code>
                {provider.attempt ? ` after attempt ${provider.attempt}` : ""}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
