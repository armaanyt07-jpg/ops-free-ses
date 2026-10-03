import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Code2, Compass, Plug } from "lucide-react";

import { CodeBlock } from "@/components/guide/code-block";
import { Done, GuideStep, Note, Substeps } from "@/components/guide/guide-step";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EVENTS_ACTIONS,
  IAM_CREATE_USER_URL,
  IAM_POLICY,
  REQUIRED_ACTIONS,
  ROUTE53_ACTIONS,
} from "@/lib/aws/iam-policy";
import {
  ACCEPTED_RESPONSE,
  ERROR_RESPONSE,
  ERROR_ROWS,
  REQUEST_FIELDS,
  STATUS_ROWS,
  TROUBLESHOOTING,
  curlSample,
  nodeSample,
  pythonSample,
} from "@/lib/guide/content";
import { appOrigin } from "@/server/public-url";
import { getTenant } from "@/server/tenant";

export const metadata: Metadata = {
  title: "Guide: from sign-up to your first email — Ops-Free SES",
  description:
    "Step-by-step setup for Ops-Free SES: connect AWS, verify a sender, create an API key and send. For newcomers and for developers who already use Amazon SES.",
};

// Depends on the visitor (signed-in nav) and the request host (API examples).
export const dynamic = "force-dynamic";

const PATHS = [
  {
    href: "#start",
    icon: Compass,
    title: "I'm new to this",
    body: "Never touched AWS or SES. Start here: every click is spelled out.",
  },
  {
    href: "#existing-ses",
    icon: Plug,
    title: "I already use Amazon SES",
    body: "You have an AWS account and maybe verified identities. Skip ahead; here's what carries over.",
  },
  {
    href: "#api",
    icon: Code2,
    title: "I just need the API",
    body: "Setup is done, or you'll do it from the dashboard. Show me the request and the errors.",
  },
];

const TOC = [
  { href: "#before", label: "Before you start" },
  { href: "#start", label: "Walkthrough" },
  { href: "#existing-ses", label: "Already use SES?" },
  { href: "#api", label: "Send from your code" },
  { href: "#statuses", label: "What happened to an email" },
  { href: "#errors", label: "API errors" },
  { href: "#troubleshooting", label: "Troubleshooting" },
];

function H2({ id, kicker, children }: { id: string; kicker: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      <p className="text-primary font-mono text-xs font-medium tracking-[0.15em] uppercase">{kicker}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{children}</h2>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.8em]">{children}</code>;
}

export default async function GuidePage() {
  const [tenant, { origin }] = await Promise.all([getTenant(), appOrigin()]);
  const signedIn = Boolean(tenant);

  return (
    <div className="min-h-screen">
      <LandingNav signedIn={signedIn} />
      <main className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
        <header className="max-w-3xl">
          <p className="text-primary font-mono text-xs font-medium tracking-[0.15em] uppercase">Guide</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            From sign-up to your first email.
          </h1>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed">
            Ops-Free sends email through <em>your own</em> Amazon SES account. Setup is connecting
            that account once; after that you call a single API. About 15 minutes, plus waiting
            for DNS if you use a domain.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {PATHS.map((p) => (
              <a
                key={p.href}
                href={p.href}
                className="bg-card hover:border-primary/40 group rounded-xl border p-4 transition-colors"
              >
                <p.icon className="text-primary size-5" aria-hidden />
                <p className="mt-3 text-sm font-medium">{p.title}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{p.body}</p>
              </a>
            ))}
          </div>
        </header>

        <div className="mt-16 grid gap-12 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav aria-label="On this page" className="sticky top-24 space-y-1 text-sm">
              <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">On this page</p>
              {TOC.map((t) => (
                <a key={t.href} href={t.href} className="text-muted-foreground hover:text-foreground block py-1 transition-colors">
                  {t.label}
                </a>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 max-w-3xl space-y-20">
            {/* ------------------------------------------------------ before */}
            <section className="space-y-4">
              <H2 id="before" kicker="Before you start">
                What you need
              </H2>
              <ul className="text-muted-foreground list-disc space-y-2 pl-5 text-sm leading-relaxed">
                <li>
                  <span className="text-foreground font-medium">An AWS account.</span> Free to open
                  at aws.amazon.com (AWS asks for a card). You pay AWS directly for the emails you send;
                  Ops-Free doesn&apos;t sit in the middle of that bill.
                </li>
                <li>
                  <span className="text-foreground font-medium">Somewhere to send from.</span> Either a
                  domain you can edit DNS for (best for inbox placement), or just your email address if
                  you don&apos;t have one yet.
                </li>
                <li>
                  <span className="text-foreground font-medium">About 15 minutes.</span> DNS changes can
                  take longer, but you can do the rest while you wait.
                </li>
              </ul>
              <Note>
                How it works: your app calls the Ops-Free API, we queue and send the message through your
                SES account, and we track what happens next. With one-click connect no secret is stored:
                we use a role in your account for short-lived sessions, and you can cut off access any time
                by deleting its CloudFormation stack in AWS. (Connecting with an access key instead stores
                the key encrypted.)
              </Note>
            </section>

            {/* ------------------------------------------------------ walkthrough */}
            <section className="space-y-8">
              <H2 id="start" kicker="Walkthrough">
                Set up, step by step
              </H2>
              <p className="text-muted-foreground -mt-4 text-sm leading-relaxed">
                The dashboard shows the same steps in the same order, with forms in place. This page
                explains what each one is for and what to do when it doesn&apos;t go as expected.
              </p>

              <ol>
                <GuideStep
                  id="step-account"
                  n={1}
                  title="Create your Ops-Free account"
                  summary="Takes a minute. This is separate from your AWS account."
                >
                  <Substeps>
                    <li>
                      Go to{" "}
                      <Link href="/signup" className="text-foreground font-medium underline underline-offset-4">
                        Sign up
                      </Link>{" "}
                      and enter your email and a password of at least 8 characters.
                    </li>
                    <li>Open the confirmation email if you&apos;re asked to, then sign in.</li>
                  </Substeps>
                  <Done>you land on a page titled &ldquo;Let&apos;s get you sending&rdquo;.</Done>
                </GuideStep>

                <GuideStep
                  id="step-aws"
                  n={2}
                  title="Connect your AWS account"
                  summary="Ops-Free needs permission to send through your SES account. One click creates a dedicated, limited role for it: no AWS login, no access key."
                >
                  <div className="space-y-2">
                    <p className="font-medium">Option A: one-click connect (recommended)</p>
                    <Substeps>
                      <li>
                        In the dashboard, open <em>AWS</em> (or the first setup step). Choose the region where
                        your SES account lives (for example <Code>ap-south-1</Code>) and click{" "}
                        <em>Connect AWS</em>.
                      </li>
                      <li>
                        A new tab opens on AWS&apos;s <em>Create stack</em> page, already filled in. Sign in to
                        your AWS account if asked.
                      </li>
                      <li>
                        Scroll to the bottom, tick the box acknowledging that AWS will create an IAM role, and
                        click <em>Create stack</em>.
                      </li>
                      <li>
                        Go back to Ops-Free. It says &ldquo;Waiting for AWS&rdquo; and turns to{" "}
                        <em>Connected</em> by itself, usually within a minute. You can close the AWS tab.
                      </li>
                    </Substeps>
                    <p className="text-muted-foreground">
                      The stack creates one IAM role in your account. Only Ops-Free can use it, only with a
                      random ID made for your connection, and only for short sessions of 15 minutes. Its
                      permissions are the same ones listed under Option B. You can{" "}
                      <a
                        href="/aws-connect.yaml"
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground underline underline-offset-4"
                      >
                        read the template
                      </a>{" "}
                      before you create it. To cut off access, delete the stack in AWS (CloudFormation → the
                      stack named <Code>OpsFreeSES-…</Code> → Delete).
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="font-medium">Option B: an IAM access key (advanced)</p>
                    <p className="text-muted-foreground">
                      Use this if you can&apos;t create CloudFormation stacks, or prefer a key. It&apos;s under
                      &ldquo;Advanced&rdquo; in the dashboard.
                    </p>
                    <Substeps>
                      <li>
                        In the AWS console, open{" "}
                        <a
                          href={IAM_CREATE_USER_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground font-medium underline underline-offset-4"
                        >
                          IAM → Users → Create user
                        </a>
                        . Name it <Code>ops-free</Code>. Leave &ldquo;console access&rdquo; off and click
                        through to create it.
                      </li>
                      <li>
                        Open the new user → <em>Add permissions → Create inline policy → JSON</em>. Paste this
                        policy and save it:
                      </li>
                    </Substeps>
                    <CodeBlock code={IAM_POLICY} label="IAM policy (JSON)" copyLabel="Copy policy" />
                    <p className="text-muted-foreground">
                      It allows sending, identity checks, event setup and (optionally) DNS publishing in
                      Route 53. Nothing else in your account.
                    </p>
                    <Substeps start={3}>
                      <li>
                        Still on the user, open <em>Security credentials → Create access key</em> and choose
                        &ldquo;Application running outside AWS&rdquo;. Copy the <em>Access key ID</em> and the{" "}
                        <em>Secret access key</em>. AWS shows the secret once.
                      </li>
                      <li>
                        Back in Ops-Free, paste both into the connect form with your AWS region. Use the region
                        where your SES account lives; domains and the sandbox are per region.
                      </li>
                    </Substeps>
                  </div>

                  <Done>
                    the step turns green and shows &ldquo;Connected&rdquo; with your region. It tells you if
                    your account is still in the SES sandbox.
                  </Done>
                  <p className="text-muted-foreground">
                    Not working? See{" "}
                    <a href="#connect-waiting" className="text-foreground underline underline-offset-4">
                      stuck on &ldquo;Waiting for AWS&rdquo;
                    </a>
                    ,{" "}
                    <a href="#access-denied" className="text-foreground underline underline-offset-4">
                      access denied
                    </a>{" "}
                    and{" "}
                    <a href="#region" className="text-foreground underline underline-offset-4">
                      which region to use
                    </a>
                    .
                  </p>
                </GuideStep>

                <GuideStep
                  id="step-sender"
                  n={3}
                  title="Verify where your emails come from"
                  summary="Amazon only sends from addresses it knows are yours. Pick one option."
                >
                  <div className="space-y-2">
                    <p className="font-medium">Option A: a domain (recommended)</p>
                    <Substeps>
                      <li>
                        Type your domain, like <Code>yourapp.com</Code>, and submit. Ops-Free creates it in your
                        SES account and shows three CNAME records.
                      </li>
                      <li>
                        Add those three records where your DNS is managed (GoDaddy, Namecheap, Cloudflare, Route
                        53&hellip;). Use the copy buttons. Many registrars want only the part before your domain
                        in the <em>Name</em> field.
                      </li>
                      <li>
                        Wait. The page checks on its own, usually within minutes; DNS can take up to 72 hours.
                      </li>
                    </Substeps>
                    <p className="text-muted-foreground">
                      If your DNS is in the same AWS account (Route 53), the records are added for you. Optionally,
                      add an SPF record that includes <Code>amazonses.com</Code>. If you already have one, edit it
                      rather than adding a second.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="font-medium">Option B: just an email address</p>
                    <Substeps>
                      <li>Choose &ldquo;Don&apos;t have a domain?&rdquo;, enter your address and submit.</li>
                      <li>Amazon emails you a confirmation link. Click it, then press &ldquo;I&apos;ve clicked the link&rdquo;.</li>
                    </Substeps>
                    <p className="text-muted-foreground">
                      You can send as that address straight away, including after you go live. You can add a domain
                      later for better inbox placement.
                    </p>
                  </div>
                  <Done>it shows &ldquo;verified&rdquo; in green.</Done>
                  <p className="text-muted-foreground">
                    Stuck on pending?{" "}
                    <a href="#dns-not-verifying" className="text-foreground underline underline-offset-4">
                      DNS troubleshooting
                    </a>
                    .
                  </p>
                </GuideStep>

                <GuideStep
                  id="step-key"
                  n={4}
                  title="Create an API key"
                  summary="The key is what your code uses to send. You can create it while DNS is still propagating."
                >
                  <Substeps>
                    <li>Click <em>Create API key</em>.</li>
                    <li>
                      Copy it now. It&apos;s shown once and can&apos;t be recovered. Store it as a secret in your
                      app (for example an environment variable named <Code>OPSFREE_API_KEY</Code>), never in code.
                    </li>
                  </Substeps>
                  <Done>you see a key starting with <Code>sk_live_</Code> and a ready-to-run example request.</Done>
                </GuideStep>

                <GuideStep
                  id="step-test"
                  n={5}
                  title="Send a test email"
                  summary="Goes through the real pipeline: queue, your SES account, outcome tracking."
                >
                  <Substeps>
                    <li>Use the test form on the setup page, or run the example request from step 4.</li>
                    <li>
                      In the SES sandbox you can only send to verified addresses. To test without that limit, send to{" "}
                      <Code>success@simulator.amazonses.com</Code>.
                    </li>
                  </Substeps>
                  <Done>
                    the email appears in <em>Activity</em> as <Code>sent</Code>. That&apos;s the setup complete; the
                    page becomes your dashboard.
                  </Done>
                </GuideStep>

                <GuideStep
                  id="step-events"
                  n={6}
                  title="Track deliveries and bounces"
                  badge="Recommended"
                  summary="Without this, every email stays on “sent”. With it you see delivered, bounced and complained, and bad addresses are blocked automatically."
                >
                  <Substeps>
                    <li>Open <em>Webhooks</em> in the dashboard, or use the last step of the setup page.</li>
                    <li>Click <em>Connect events</em>.</li>
                  </Substeps>
                  <p className="text-muted-foreground">
                    In your AWS account this creates an SNS topic named <Code>ops-free-ses-events</Code> and an SES
                    configuration set named <Code>ops-free</Code>, and subscribes Ops-Free to it. You can delete both
                    in AWS at any time. Pressing the button again repairs a half-finished setup.
                  </p>
                  <Done>
                    a test email to <Code>success@simulator.amazonses.com</Code> moves from <Code>sent</Code> to{" "}
                    <Code>delivered</Code> within a few seconds.
                  </Done>
                </GuideStep>

                <GuideStep
                  id="step-production"
                  n={7}
                  title="Start sending to anyone"
                  badge="Before going live"
                  summary="New AWS accounts are in the SES sandbox: only verified recipients, 200 emails a day. Production access lifts that."
                  last
                >
                  <Substeps>
                    <li>Open <em>Start sending to anyone</em> in the dashboard.</li>
                    <li>Answer the few questions. Ops-Free writes the request to AWS for you.</li>
                    <li>Submit it in the AWS console as shown. AWS usually replies within about a day.</li>
                  </Substeps>
                  <Done>the dashboard no longer shows the &ldquo;SES sandbox&rdquo; label on your connection.</Done>
                </GuideStep>
              </ol>
            </section>

            {/* ------------------------------------------------------ existing SES */}
            <section className="space-y-6">
              <H2 id="existing-ses" kicker="For existing SES users">
                Already use Amazon SES?
              </H2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                You can skip most of the walkthrough. Your SES account, quotas and verified identities stay exactly
                as they are, and anything that sends to SES directly keeps working. Ops-Free just adds an API,
                queueing, retries, a blocked list and outcome tracking on top.
              </p>
              <Substeps className="text-sm">
                <li>
                  <span className="text-foreground font-medium">Create or reuse an IAM user.</span> A dedicated user is
                  safer. If you reuse one, make sure it can do the following:
                </li>
              </Substeps>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Sending", REQUIRED_ACTIONS],
                  ["Event tracking", EVENTS_ACTIONS],
                  ["Route 53 (optional)", ROUTE53_ACTIONS],
                ].map(([title, actions]) => (
                  <div key={title as string} className="rounded-xl border p-3.5">
                    <p className="text-xs font-medium">{title as string}</p>
                    <ul className="text-muted-foreground mt-2 space-y-1 font-mono text-[0.68rem] leading-snug">
                      {(actions as readonly string[]).map((a) => (
                        <li key={a} className="break-all">{a}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <Substeps start={2} className="text-sm">
                <li>
                  <span className="text-foreground font-medium">Connect it</span> with the region where your identities
                  live (step 2 above).
                </li>
                <li>
                  <span className="text-foreground font-medium">Add your domain.</span> If it already exists in that
                  region, Ops-Free adopts it instead of failing and reads its current status, so a verified domain shows
                  verified straight away. You won&apos;t need to touch DNS again.
                </li>
                <li>
                  <span className="text-foreground font-medium">Create an API key</span> and switch your calls to{" "}
                  <a href="#api" className="text-foreground underline underline-offset-4">
                    the Ops-Free API
                  </a>
                  .
                </li>
                <li>
                  <span className="text-foreground font-medium">Optionally connect events.</span> Read the note below first.
                </li>
              </Substeps>
              <Note>
                <span className="text-foreground font-medium">Two things to know before connecting events.</span> It sets the{" "}
                <Code>ops-free</Code> configuration set as the default on the domains you add here, replacing any
                default you had on that identity. And only emails sent through Ops-Free appear in Activity; mail you
                send straight through SES isn&apos;t tracked here.
              </Note>
              <p className="text-muted-foreground text-sm leading-relaxed">
                If your account is already out of the sandbox, there&apos;s nothing more to do. If it isn&apos;t, see{" "}
                <a href="#step-production" className="text-foreground underline underline-offset-4">
                  step 7
                </a>
                .
              </p>
            </section>

            {/* ------------------------------------------------------ API */}
            <section className="space-y-6">
              <H2 id="api" kicker="For developers">
                Send from your code
              </H2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                One endpoint, <Code>POST {origin}/api/v1/send</Code>, authenticated with your API key as a bearer
                token. It validates the request, checks your blocked list, stores the message and queues it, then
                answers <Code>202</Code> before delivery finishes. Track the outcome in Activity or from the id it
                returns.
              </p>

              <div className="space-y-3">
                <CodeBlock code={curlSample(origin)} label="curl" />
                <CodeBlock code={nodeSample(origin)} label="Node.js (fetch)" />
                <CodeBlock code={pythonSample(origin)} label="Python (requests)" />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Request body</p>
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {REQUEST_FIELDS.map((f) => (
                        <TableRow key={f.name}>
                          <TableCell className="font-mono text-xs">{f.name}</TableCell>
                          <TableCell className="text-muted-foreground font-mono text-xs">{f.type}</TableCell>
                          <TableCell className="text-xs">{f.required}</TableCell>
                          <TableCell className="text-muted-foreground text-xs whitespace-normal">{f.note}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium">Success: 202</p>
                  <CodeBlock code={ACCEPTED_RESPONSE} label="JSON" />
                </div>
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium">Failure: any other status</p>
                  <CodeBlock code={ERROR_RESPONSE} label="JSON" />
                </div>
              </div>

              <div className="text-muted-foreground space-y-3 text-sm leading-relaxed">
                <p>
                  <span className="text-foreground font-medium">Retrying safely.</span> Add an{" "}
                  <Code>Idempotency-Key</Code> header (any string up to 255 characters, unique per email you intend to
                  send). If a request times out and you retry with the same key, you get a <Code>409</Code> carrying the
                  original email&apos;s id instead of a second email. Treat that as success.
                </p>
                <p>
                  <span className="text-foreground font-medium">Limits.</span> Up to 50 recipients per request. By
                  default each key may send about 50 requests a second (bursts to 100); beyond that you get{" "}
                  <Code>429 RATE_LIMITED</Code>. Your SES account has its own limits too, and the sandbox is far lower.
                </p>
                <p>
                  <span className="text-foreground font-medium">Every response carries an</span>{" "}
                  <Code>X-Request-Id</Code> header. Quote it if you contact support.
                </p>
              </div>
            </section>

            {/* ------------------------------------------------------ statuses */}
            <section className="space-y-4">
              <H2 id="statuses" kicker="Reference">
                What happened to an email
              </H2>
              <div className="overflow-hidden rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Status</TableHead>
                      <TableHead>Meaning</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {STATUS_ROWS.map((s) => (
                      <TableRow key={s.status}>
                        <TableCell className="font-mono text-xs">{s.status}</TableCell>
                        <TableCell className="text-muted-foreground text-xs whitespace-normal">{s.meaning}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            {/* ------------------------------------------------------ errors */}
            <section className="space-y-4">
              <H2 id="errors" kicker="Reference">
                API errors
              </H2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Errors are JSON with a stable <Code>code</Code>. Branch on the code, not the message text.
              </p>
              <div className="overflow-hidden rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead className="w-16">HTTP</TableHead>
                      <TableHead>What it means and what to do</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ERROR_ROWS.map((e) => (
                      <TableRow key={e.code}>
                        <TableCell className="align-top font-mono text-xs">{e.code}</TableCell>
                        <TableCell className="align-top font-mono text-xs">{e.status}</TableCell>
                        <TableCell className="text-xs whitespace-normal">
                          <span>{e.meaning}</span>
                          <span className="text-muted-foreground mt-1 block">{e.fix}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            {/* ------------------------------------------------------ troubleshooting */}
            <section className="space-y-4">
              <H2 id="troubleshooting" kicker="Help">
                Troubleshooting
              </H2>
              <div className="space-y-2">
                {TROUBLESHOOTING.map((t) => (
                  <details key={t.id} id={t.id} className="group bg-card scroll-mt-24 rounded-xl border px-4 py-3 open:pb-4">
                    <summary className="cursor-pointer text-sm font-medium">{t.question}</summary>
                    <div className="text-muted-foreground mt-3 space-y-2.5 text-sm leading-relaxed">
                      {t.answer.map((p) => (
                        <p key={p}>{p}</p>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>

            {/* ------------------------------------------------------ cta */}
            <section className="rounded-2xl border p-6 text-center sm:p-10">
              <h2 className="text-2xl font-semibold tracking-tight">Ready?</h2>
              <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
                {signedIn
                  ? "Pick up where you left off."
                  : "Create an account and the dashboard walks you through these same steps."}
              </p>
              <Button asChild className="mt-5">
                <Link href={signedIn ? "/dashboard" : "/signup"}>
                  {signedIn ? "Open the dashboard" : "Create an account"}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </section>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
