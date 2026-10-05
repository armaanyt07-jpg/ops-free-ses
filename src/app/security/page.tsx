import type { Metadata } from "next";
import Link from "next/link";

import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { CodeBlock } from "@/components/guide/code-block";
import { LEGAL } from "@/lib/legal/config";
import { CONNECT_ROLE_PREFIX } from "@/lib/aws/connect-template";
import { EVENTS_ACTIONS, IAM_POLICY, REQUIRED_ACTIONS, ROUTE53_ACTIONS } from "@/lib/aws/iam-policy";
import { COMPLETED_JOB_RETENTION_HOURS, FAILED_JOB_RETENTION_DAYS } from "@/lib/queue/retention";
import { getTenant } from "@/server/tenant";

export const metadata: Metadata = {
  title: "Security — Ops-Free SES",
  description:
    "Exactly what Ops-Free can and can't do in your AWS account, how we store credentials, and how to revoke our access in one step.",
};

// The nav swaps sign-in for a dashboard link when the visitor is signed in.
export const dynamic = "force-dynamic";

const SECTIONS: Array<[string, string]> = [
  ["short", "The short version"],
  ["connect", "What one-click connect creates"],
  ["permissions", "Exactly what we can do"],
  ["revoke", "Revoking our access"],
  ["stored", "What we store"],
  ["separation", "Keeping customers apart"],
  ["platform", "Our own access, and why it's narrow"],
  ["where", "Where it runs"],
  ["not-yet", "What we don't have yet"],
  ["report", "Reporting a problem"],
];

const PERMISSIONS: Array<{ group: string; why: string; actions: readonly string[] }> = [
  {
    group: "Send email and manage identities",
    why: "Sends your mail, checks whether your account is still in the SES sandbox, and adds and checks your domains and sender addresses.",
    actions: REQUIRED_ACTIONS,
  },
  {
    group: "Delivery events",
    why: "Creates one configuration set and one SNS topic in your account so bounces, complaints and deliveries are reported back to us, which is how suppression works.",
    actions: EVENTS_ACTIONS,
  },
  {
    group: "Route 53 (optional)",
    why: "Only if your domain's DNS is in the same AWS account: adds the DKIM records for the domain you're setting up, so you don't paste them yourself. The code does nothing else with it.",
    actions: ROUTE53_ACTIONS,
  },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="text-muted-foreground space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground font-medium">{children}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-[0.8rem] [overflow-wrap:anywhere]">{children}</code>;
}

export default async function SecurityPage() {
  const signedIn = Boolean(await getTenant());

  return (
    <div className="min-h-screen">
      <LandingNav signedIn={signedIn} />
      <main className="mx-auto max-w-3xl px-6 py-14 sm:py-20">
        <p className="text-primary font-mono text-xs font-medium tracking-[0.15em] uppercase">Security</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance">
          Your AWS account stays yours. Here is exactly what we can touch.
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">Last updated {LEGAL.updated}</p>
        <p className="text-muted-foreground mt-6 text-base leading-relaxed">
          Using Ops-Free means letting it send email through your Amazon SES account. That is a real
          decision, so this page lists the permissions we ask for, what we store, and how to take it all
          back, including the parts we haven&apos;t done yet.
        </p>

        <nav aria-label="Sections" className="bg-card mt-8 rounded-xl border p-4 text-sm">
          <ol className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {SECTIONS.map(([id, heading], i) => (
              <li key={id}>
                <a href={`#${id}`} className="text-muted-foreground hover:text-foreground transition-colors">
                  {i + 1}. {heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-12 space-y-12">
          <Section id="short" title="The short version">
            <UL>
              <li>
                <B>Your mail is sent by your AWS account</B>, under your own agreement with Amazon, and
                Amazon bills you directly. Your sending reputation is yours alone.
              </li>
              <li>
                <B>One-click connect stores no secret.</B> You create one IAM role. There is no password or
                access key for us to keep, lose or leak.
              </li>
              <li>
                <B>The role can only do SES things.</B> It can&apos;t read your files, launch servers,
                change your other IAM settings or touch your databases. The full list is below.
              </li>
              <li>
                <B>Delete one CloudFormation stack and our access is gone</B>, within about 15 minutes.
              </li>
            </UL>
          </Section>

          <Section id="connect" title="What one-click connect creates">
            <p>
              Pressing <B>Connect AWS</B> opens your AWS console on a pre-filled CloudFormation page. You tick
              one box and press <B>Create stack</B>. The stack creates a single IAM role named{" "}
              <Code>{CONNECT_ROLE_PREFIX}…</Code> in your account. You can{" "}
              <Link href="/aws-connect.yaml" className="text-foreground underline underline-offset-4">
                read the whole template
              </Link>{" "}
              before you do.
            </p>
            <UL>
              <li>
                <B>Who can use the role.</B> Its trust policy names one identity, Ops-Free&apos;s platform
                user, and no one else.
              </li>
              <li>
                <B>An ExternalId only you and we know.</B> The role only works when we present the random
                ExternalId generated for your account. This is AWS&apos;s standard defence against a
                &ldquo;confused deputy&rdquo;: another Ops-Free customer can&apos;t trick us into using your
                role, because they don&apos;t have your ExternalId.
              </li>
              <li>
                <B>Short-lived access.</B> We get temporary credentials through AWS STS that last 15 minutes
                and are refreshed as needed. Nothing long-lived is kept.
              </li>
              <li>
                <B>Verified before it counts.</B> We don&apos;t trust the stack&apos;s message that it
                finished. We actually assume the role and read your SES account before marking you
                connected.
              </li>
            </UL>
          </Section>

          <Section id="permissions" title="Exactly what we can do">
            <p>
              The role carries these permissions and no others. The same list appears in the setup guide, and
              the code reads it from one place, so the page can&apos;t drift from what the product does.
            </p>
            <div className="space-y-4">
              {PERMISSIONS.map((p) => (
                <div key={p.group} className="bg-card rounded-xl border p-4">
                  <p className="text-foreground text-sm font-medium">{p.group}</p>
                  <p className="mt-1">{p.why}</p>
                  <p className="mt-3 flex flex-wrap gap-1.5">
                    {p.actions.map((a) => (
                      <Code key={a}>{a}</Code>
                    ))}
                  </p>
                </div>
              ))}
            </div>
            <p>
              <B>Be aware:</B> these permissions apply to <Code>Resource: *</Code>, meaning every SES identity
              and, for the optional Route 53 permission, every hosted zone in the account. The role can send as
              any identity you have verified in that region, which is what a sending service has to be able to
              do. If you want a tighter boundary, use a separate AWS account for sending.
            </p>
            <p>
              <B>What it can&apos;t do:</B> read or change anything outside SES, SNS topic creation and the
              optional DNS records. No S3, EC2, databases, billing or IAM.
            </p>
            <CodeBlock code={IAM_POLICY} label="The role's permissions (JSON)" copyLabel="Copy policy" />
          </Section>

          <Section id="revoke" title="Revoking our access">
            <p>
              In the AWS console, open CloudFormation and delete the stack whose name starts with the connection
              you created. That deletes the role. Ops-Free is told, marks the connection as removed, and even a
              session we had cached stops working within 15 minutes. You can also delete the role directly in
              IAM, or tell us to delete your account (see our{" "}
              <Link href="/privacy" className="text-foreground underline underline-offset-4">
                Privacy Policy
              </Link>
              ).
            </p>
            <p>
              Revoking never touches your SES identities, domains or sending history in your own account. Those
              stay with you.
            </p>
          </Section>

          <Section id="stored" title="What we store">
            <UL>
              <li>
                <B>One-click connection:</B> the role&apos;s name (ARN), its region and the random ExternalId.
                No secret.
              </li>
              <li>
                <B>Access-key connection (the &ldquo;Advanced&rdquo; option):</B> if you choose it, the secret key
                is encrypted with AES-256-GCM before storage, bound to your account so it can&apos;t be moved to
                another customer&apos;s row, and never shown again. We recommend dedicated keys with only the
                permissions above. The one-click role is the safer choice.
              </li>
              <li>
                <B>API keys:</B> only a one-way hash and a short display prefix. We can&apos;t show a key
                again. If you lose it, create a new one.
              </li>
              <li>
                <B>Message content:</B> not stored in our database. A message body sits in our queue until it is
                sent and is removed about {COMPLETED_JOB_RETENTION_HOURS} hours later. A permanently failed
                message is kept up to {FAILED_JOB_RETENTION_DAYS} days so you can retry it. We do keep records
                of each message (sender, recipient, subject, status) so the dashboard can show you what
                happened.
              </li>
              <li>
                <B>Logs:</B> use an allow-list of fields. Tests check that secrets and message bodies don&apos;t
                appear in them.
              </li>
            </UL>
            <p>
              The encryption master key can be rotated without asking you to re-enter anything. The full detail
              is in the{" "}
              <Link href="/privacy" className="text-foreground underline underline-offset-4">
                Privacy Policy
              </Link>
              .
            </p>
          </Section>

          <Section id="separation" title="Keeping customers apart">
            <UL>
              <li>Every database query is scoped to the signed-in account, and no route takes an account ID from the request.</li>
              <li>
                Row-level security is turned on for every table and the public database API is closed. A test
                fails the build if a new table is missing it.
              </li>
              <li>
                Automated tests act as one customer and check that nothing of another customer&apos;s can be read
                or changed.
              </li>
              <li>
                Delivery-event webhooks are signature-verified before any work is done, and the endpoints are
                rate limited.
              </li>
            </UL>
          </Section>

          <Section id="platform" title="Our own access, and why it's narrow">
            <p>
              Ops-Free has one AWS identity of its own, used only to assume customers&apos; roles. Its only
              permission is <Code>sts:AssumeRole</Code> on roles named <Code>{CONNECT_ROLE_PREFIX}*</Code>, and every
              role also demands that customer&apos;s own ExternalId. If that identity&apos;s key were ever leaked, we
              would rotate it without you having to reconnect, and the key alone couldn&apos;t assume a role
              without the ExternalId.
            </p>
          </Section>

          <Section id="where" title="Where it runs">
            <p>
              The database and website run in Mumbai, the sending worker in Singapore, and the queue in Mumbai.
              Error reports go to a monitoring service in the United States, with email addresses and key-like
              strings removed. The full list of providers is in the{" "}
              <Link href="/privacy#sharing" className="text-foreground underline underline-offset-4">
                Privacy Policy
              </Link>
              . Traffic uses HTTPS, and the site sets security headers.
            </p>
          </Section>

          <Section id="not-yet" title="What we don't have yet">
            <p>We would rather you know now than assume:</p>
            <UL>
              <li>
                <B>No SOC 2 or ISO 27001 certification.</B> We&apos;re a small team. If you need one for
                procurement, Ops-Free isn&apos;t ready for you yet.
              </li>
              <li>
                <B>No independent penetration test yet.</B> We have done our own full security review of the
                code, the database and the dependencies, and we keep automated tests that guard each fix.
                That is not the same as an outside audit.
              </li>
              <li>
                <B>One-click connect is new.</B> It has been proven end to end against real AWS using a single
                account. The delete-the-stack revoke path is covered by our tests but we haven&apos;t yet
                confirmed it on a second, separate AWS account.
              </li>
            </UL>
          </Section>

          <Section id="report" title="Reporting a problem">
            <p>
              If you find a security problem, email{" "}
              <a href={`mailto:${LEGAL.contactEmail}`} className="text-foreground underline underline-offset-4">
                {LEGAL.contactEmail}
              </a>{" "}
              with &ldquo;Security&rdquo; in the subject. Please give us a reasonable chance to fix it before
              you share it publicly, and don&apos;t access other customers&apos; data. We will reply, tell you
              what we find, and credit you if you want.
            </p>
          </Section>
        </div>

        <p className="text-muted-foreground mt-16 border-t pt-6 text-sm">
          See also our{" "}
          <Link href="/terms" className="text-foreground underline underline-offset-4">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-foreground underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
