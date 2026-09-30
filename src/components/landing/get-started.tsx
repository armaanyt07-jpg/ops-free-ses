import Link from "next/link";

import { SectionKicker } from "@/components/landing/section-kicker";
import { Button } from "@/components/ui/button";
import { IAM_POLICY } from "@/lib/aws/iam-policy";

interface Step {
  title: string;
  body: React.ReactNode;
  code?: string;
  optional?: boolean;
}

const STEPS: Step[] = [
  {
    title: "Create an account",
    body: "Sign up with an email and password.",
  },
  {
    title: "Connect your AWS account",
    body: (
      <>
        In the AWS console, create an IAM user with the policy below and an
        access key for it, then paste the key into the setup screen. It is
        validated against AWS and stored encrypted.
      </>
    ),
    code: IAM_POLICY,
  },
  {
    title: "Verify your domain or email address",
    body: (
      <>
        Type your domain. Ops-Free creates it in your SES account and shows
        three DNS records to add, with copy buttons. If your DNS is in Route 53,
        they&apos;re added for you. No domain yet? Verify your email address
        instead: click the link Amazon sends you, and you can send.
      </>
    ),
  },
  {
    title: "Create an API key and send",
    body: (
      <>
        One click creates your key and shows a ready-to-run request. Send a
        test email from the dashboard, or call{" "}
        <code className="font-mono text-xs">POST /api/v1/send</code> from your
        app.
      </>
    ),
  },
  {
    title: "Track deliveries and bounces",
    optional: true,
    body: (
      <>
        One click sets up Amazon SNS in your account, so every email&apos;s
        outcome shows up in the dashboard and bounced addresses are suppressed
        automatically.
      </>
    ),
  },
  {
    title: "Leave the SES sandbox",
    optional: true,
    body: (
      <>
        New SES accounts can only send to verified addresses, up to 200 emails a
        day.{" "}
        <span className="text-foreground font-medium">Production access</span>{" "}
        prepares the request for you to submit to AWS, which usually reviews it
        within a day.
      </>
    ),
  },
];

export function GetStarted() {
  return (
    <section id="get-started" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="04" label="Get started" />
        <div className="grid gap-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <div className="lg:sticky lg:top-24">
            <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
              From sign-up to first email.
            </h2>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              Four steps to send, two more before you go to production. You
              need an AWS account, and a domain or just an email address.
            </p>
            <Button asChild className="mt-8">
              <Link href="/signup">Create an account</Link>
            </Button>
          </div>

          <ol className="space-y-0">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative flex gap-5 pb-10 last:pb-0">
                {i < STEPS.length - 1 ? (
                  <span
                    aria-hidden
                    className="bg-border absolute top-9 bottom-1 left-[15px] w-px"
                  />
                ) : null}
                <span className="bg-card text-primary relative grid size-8 shrink-0 place-items-center rounded-full border font-mono text-xs font-medium tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {step.title}
                    {step.optional ? (
                      <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[0.65rem] font-normal">
                        Before production
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                    {step.body}
                  </p>
                  {step.code ? (
                    <pre className="mt-4 overflow-x-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200">
                      {step.code}
                    </pre>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
