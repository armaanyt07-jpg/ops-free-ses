import { CheckCircle2, Lock } from "lucide-react";

import { checkDomainNow } from "@/app/dashboard/domains/actions";
import { CredentialForm } from "@/components/dashboard/credential-form";
import { DnsRecords } from "@/components/dashboard/dns-records";
import { DomainForm } from "@/components/dashboard/domain-form";
import { EmailIdentityForm } from "@/components/dashboard/email-identity-form";
import { EmailIdentityPending } from "@/components/dashboard/email-identity-status";
import { IamSetup } from "@/components/dashboard/iam-setup";
import { ConnectEventsButton, QuickKeyStep } from "@/components/dashboard/setup-actions";
import { TestSendForm } from "@/components/dashboard/test-send-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { EmailIdentity } from "@/db/schema";
import { cn } from "@/lib/utils";
import type { CredentialSummary } from "@/server/credentials";
import type { DomainView } from "@/server/domains";

/**
 * First-run setup (Phase 8). Replaces the Overview until the account can send:
 * one page, in order, with every step done in place instead of a checklist of
 * links to other pages.
 *
 * The API key step is available as soon as AWS is connected, so the key can be
 * created while DNS propagates. Events are optional and never block sending.
 */
export interface SetupGuideProps {
  credential: CredentialSummary | undefined;
  domains: DomainView[];
  /** Phase 8: verified sender addresses, for users without a domain. */
  emails: EmailIdentity[];
  hasKey: boolean;
  eventsConnected: boolean;
  appUrl: string;
  local: boolean;
}

type StepState = "done" | "current" | "locked";

function Step({
  n,
  title,
  state,
  summary,
  optional,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  summary?: React.ReactNode;
  optional?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="group relative flex gap-4 pb-8 last:pb-0">
      <span aria-hidden className="bg-border absolute top-9 bottom-0 left-[15px] w-px group-last:hidden" />
      <span
        className={cn(
          "relative grid size-8 shrink-0 place-items-center rounded-full border font-mono text-xs font-medium tabular-nums",
          state === "done" && "border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950",
          state === "current" && "border-primary bg-primary text-primary-foreground",
          state === "locked" && "bg-muted text-muted-foreground",
        )}
      >
        {state === "done" ? <CheckCircle2 className="size-4" aria-label="Done" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className={cn(state === "locked" && "text-muted-foreground")}>{title}</span>
          {optional ? (
            <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[0.65rem] font-normal">
              Optional
            </span>
          ) : null}
          {state === "locked" ? <Lock className="text-muted-foreground size-3.5" aria-label="Locked" /> : null}
        </h3>
        {summary ? <div className="text-muted-foreground mt-1 text-sm">{summary}</div> : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </li>
  );
}

export function SetupGuide({
  credential,
  domains,
  emails,
  hasKey,
  eventsConnected,
  appUrl,
  local,
}: SetupGuideProps) {
  const verified = domains.find((d) => d.status === "verified");
  const pending = domains.find((d) => d.status !== "verified");
  const verifiedEmail = emails.find((e) => e.status === "verified");
  const pendingEmail = emails.find((e) => e.status !== "verified");
  const canSend = Boolean(verified || verifiedEmail);
  const connected = Boolean(credential);
  const done = [connected, canSend, hasKey].filter(Boolean).length;
  const from = verified
    ? `hello@${verified.domain}`
    : verifiedEmail
      ? verifiedEmail.email
      : pending
        ? `hello@${pending.domain}`
        : "you@example.com";

  const emailOption = (
    <details className="group rounded-lg border px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        Don&apos;t have a domain? Send from your email address
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground text-sm">
          Amazon emails you a confirmation link; once you click it you can send, including
          after you go live. A domain of your own gets better inbox placement, and you can add
          one any time.
        </p>
        <EmailIdentityForm />
      </div>
    </details>
  );

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Let&apos;s get you sending</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Connect your AWS account, verify a domain, and send your first email. It takes a
          few minutes; after that this page becomes your dashboard.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <div className="bg-muted h-1.5 w-40 overflow-hidden rounded-full" aria-hidden>
            <div className="bg-primary h-full rounded-full" style={{ width: `${(done / 3) * 100}%` }} />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">{done} of 3 done</span>
        </div>
      </div>

      <Card>
        <CardContent className="py-2">
          <ol>
            <Step
              n={1}
              title="Connect your AWS account"
              state={connected ? "done" : "current"}
              summary={
                credential
                  ? `Connected · ${credential.awsRegion}${
                      credential.account && !credential.account.productionAccessEnabled ? " · SES sandbox" : ""
                    }`
                  : "Emails are sent from your own Amazon SES account. We need an access key for it."
              }
            >
              {connected ? null : (
                <div className="space-y-6">
                  <IamSetup />
                  <CredentialForm />
                </div>
              )}
            </Step>

            <Step
              n={2}
              title="Verify where your emails come from"
              state={canSend ? "done" : connected ? "current" : "locked"}
              summary={
                verified
                  ? `${verified.domain} is verified.`
                  : verifiedEmail
                    ? `Sending as ${verifiedEmail.email}. You can add your own domain later on the Domains page.`
                    : pendingEmail
                      ? `Waiting for you to confirm ${pendingEmail.email}.`
                      : pending
                        ? `Waiting for DNS on ${pending.domain}. We check automatically — this page updates when it's verified.`
                        : "Your domain, like yourapp.com — or just your email address."
              }
            >
              {!connected || canSend ? null : pendingEmail ? (
                <EmailIdentityPending identity={pendingEmail} />
              ) : pending ? (
                <div className="space-y-4">
                  <DnsRecords domain={pending.domain} records={pending.records} />
                  <form action={checkDomainNow}>
                    <input type="hidden" name="id" value={pending.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Check now
                    </Button>
                  </form>
                  {emailOption}
                </div>
              ) : (
                <div className="space-y-4">
                  <DomainForm />
                  {emailOption}
                </div>
              )}
            </Step>

            <Step
              n={3}
              title="Create an API key"
              state={hasKey ? "done" : connected ? "current" : "locked"}
            >
              {connected ? <QuickKeyStep done={hasKey} appUrl={appUrl} from={from} /> : null}
            </Step>

            <Step
              n={4}
              title="Send a test email"
              state={canSend && hasKey ? "current" : "locked"}
              summary={
                canSend
                  ? "Goes through the real pipeline. The simulator address works even in the SES sandbox."
                  : "Unlocks once your domain or email address is verified."
              }
            >
              {canSend ? <TestSendForm defaultFrom={from} /> : null}
            </Step>

            <Step
              n={5}
              title="Track deliveries and bounces"
              optional
              state={eventsConnected ? "done" : connected ? "current" : "locked"}
              summary={
                eventsConnected
                  ? "Connected. Deliveries, bounces and complaints show up in Activity."
                  : "One click sets up Amazon SNS in your account so you see what happened to each email and bounced addresses stop being sent to."
              }
            >
              {connected && !eventsConnected ? <ConnectEventsButton local={local} /> : null}
            </Step>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
