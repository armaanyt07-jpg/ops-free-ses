import Link from "next/link";

import { SectionKicker } from "@/components/landing/section-kicker";
import { Button } from "@/components/ui/button";

const IAM_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ses:GetAccount",
      "ses:SendEmail",
      "ses:CreateEmailIdentity",
      "ses:GetEmailIdentity"
    ],
    "Resource": "*"
  }]
}`;

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
        access key for it. Paste the access key ID, secret and the SES region
        into <span className="text-foreground font-medium">AWS</span> in the
        dashboard. It is validated against AWS and stored encrypted.
      </>
    ),
    code: IAM_POLICY,
  },
  {
    title: "Verify your sending domain",
    body: (
      <>
        Add your domain under{" "}
        <span className="text-foreground font-medium">Domains</span>. Ops-Free
        creates the identity in your SES account and lists three DKIM CNAME
        records. Publish them at your DNS provider; SES usually verifies within
        minutes, sometimes up to 72 hours.
      </>
    ),
  },
  {
    title: "Create an API key",
    body: (
      <>
        Under <span className="text-foreground font-medium">API keys</span>,
        create a key. The secret is shown once, so store it in your app&apos;s
        environment.
      </>
    ),
  },
  {
    title: "Send your first email",
    body: (
      <>
        Call <code className="font-mono text-xs">POST /api/v1/send</code> with
        the key as a bearer token, or use{" "}
        <span className="text-foreground font-medium">Send a test email</span>{" "}
        on the dashboard. The request format is shown below.
      </>
    ),
  },
  {
    title: "Track deliveries and bounces",
    optional: true,
    body: (
      <>
        Connect an Amazon SNS topic under{" "}
        <span className="text-foreground font-medium">Webhooks</span> so
        deliveries, bounces and complaints show up in the dashboard and bounced
        addresses are suppressed automatically.
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
              Five steps to send, two more before you go to production. You
              need an AWS account and a domain you can add DNS records to.
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
