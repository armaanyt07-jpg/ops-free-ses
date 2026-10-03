import type { Metadata } from "next";
import Link from "next/link";

import { B, LegalPage, Section, UL } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal/config";
import { COMPLETED_JOB_RETENTION_HOURS, FAILED_JOB_RETENTION_DAYS } from "@/lib/queue/retention";

export const metadata: Metadata = {
  title: "Privacy Policy — Ops-Free SES",
  description: "What Ops-Free SES collects, why, who else handles it, how long it is kept, and your choices.",
};

const SECTIONS: Array<[string, string]> = [
  ["who", "Who we are"],
  ["collect", "What we collect"],
  ["use", "How we use it"],
  ["recipients", "Your recipients’ data"],
  ["sharing", "Who else handles it"],
  ["retention", "How long we keep it"],
  ["security", "How we protect it"],
  ["cookies", "Cookies"],
  ["rights", "Your choices and rights"],
  ["children", "Children"],
  ["changes", "Changes"],
  ["contact", "Contact"],
];

const SUBPROCESSORS: Array<[string, string, string]> = [
  ["Supabase", "Database and sign-in (accounts, settings, logs)", "Mumbai, India"],
  ["Vercel", "Hosting the website, dashboard and API", "Mumbai, India"],
  ["Railway", "Background worker that sends your email", "Singapore"],
  ["Upstash", "The message queue (Redis) and rate-limit counters", LEGAL.upstashRegion],
  ["Sentry", "Error reports (scrubbed, see below)", "United States"],
  [LEGAL.signupEmailProvider, "Sign-up and password-reset emails sent to you", "—"],
  ["Amazon Web Services (your account)", "Sends your email and reports delivery events, under your own agreement with AWS", "The region you chose"],
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`This explains what ${LEGAL.product} (${LEGAL.site}) collects when you use it, why, who else handles it, how long we keep it, and what you can do about it. We’ve tried to say plainly what actually happens.`}
      sections={SECTIONS}
    >
      <Section id="who" n={1} title="Who we are">
        <p>
          {LEGAL.operator} runs {LEGAL.product} and decides how the personal data described here is used. Contact:{" "}
          {LEGAL.contactEmail}, {LEGAL.postalAddress}.
        </p>
      </Section>

      <Section id="collect" n={2} title="What we collect">
        <UL>
          <li>
            <B>Your account.</B> Your email address and password. The password goes to our sign-in provider and is
            stored there in hashed form; we don’t keep it ourselves.
          </li>
          <li>
            <B>Your AWS connection.</B> If you connect with one click: the name (ARN) of the IAM role created in your
            account, the region, and a random identifier we generated for your connection. No secret is stored. If you
            connect with an access key: the access key ID, the region, and the secret access key, where the secret is
            encrypted (AES-256-GCM) before it is stored and is never shown again. We never ask for your AWS login.
          </li>
          <li>
            <B>API keys.</B> Only a one-way hash of each key and a short display prefix. The full key is shown to you
            once and can’t be recovered.
          </li>
          <li>
            <B>Records of your email.</B> For each message: the sender and recipient addresses, the subject, status and
            timestamps, any error text, tags you set, and the delivery, bounce and complaint events AWS reports (in a
            reduced form, with message headers and subjects removed).
          </li>
          <li>
            <B>Message content.</B> The body of each email passes through our queue until it is sent (see{" "}
            <a href="#retention" className="text-foreground underline underline-offset-4">
              how long we keep it
            </a>
            ). We don’t store message bodies in our database. The exception is templates you save, which we store so you
            can use them.
          </li>
          <li>
            <B>Setup data.</B> Your domains and verified sender addresses, DNS check results, your blocked-address list,
            and, if you use the production-access assistant, your answers to its questions.
          </li>
          <li>
            <B>Technical data.</B> Server logs with a request ID, your account ID and outcome (not message bodies, and
            never credentials); IP addresses, which our host sees and which we use briefly for rate limiting; and error
            reports sent to our error-monitoring service, in which email addresses and key-like strings are redacted and
            database values are removed.
          </li>
        </UL>
      </Section>

      <Section id="use" n={3} title="How we use it">
        <UL>
          <li>To provide the service: sign you in, send your email through your AWS account, show you what happened to it.</li>
          <li>To keep it secure and fair: rate limiting, abuse prevention, finding and fixing bugs.</li>
          <li>To support you, and to tell you about important changes to the service or these documents.</li>
          <li>To meet legal obligations.</li>
        </UL>
        <p>We don’t sell your data, and we don’t use it for advertising.</p>
      </Section>

      <Section id="recipients" n={4} title="Your recipients’ data">
        <p>
          When you send email, the addresses and content are your recipients’ personal data and you decide what to send
          and to whom. We handle them on your behalf, only to deliver the email and show you the result. You are
          responsible for having the right to email them, as set out in our{" "}
          <Link href="/terms#content" className="text-foreground underline underline-offset-4">
            Terms
          </Link>
          .
        </p>
      </Section>

      <Section id="sharing" n={5} title="Who else handles it">
        <p>These providers process data for us to run the service:</p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">What for</th>
                <th className="px-3 py-2 font-medium">Where</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SUBPROCESSORS.map(([name, why, where]) => (
                <tr key={name}>
                  <td className="text-foreground px-3 py-2 align-top">{name}</td>
                  <td className="px-3 py-2 align-top">{why}</td>
                  <td className="px-3 py-2 align-top">{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Your data is therefore processed in India, Singapore and the United States. We may also disclose it if the law
          requires, or to protect the service and its users from serious harm.
        </p>
      </Section>

      <Section id="retention" n={6} title="How long we keep it">
        <UL>
          <li>
            <B>Account, settings and records of your email:</B> until you ask us to delete your account. We don’t
            currently delete email records automatically. If we add a retention period we will tell you first.
          </li>
          <li>
            <B>Message content in the queue:</B> removed about {COMPLETED_JOB_RETENTION_HOURS} hours after a message is
            sent. If a message fails permanently, its content is kept for up to {FAILED_JOB_RETENTION_DAYS} days so you
            can investigate and retry it.
          </li>
          <li>
            <B>Backups and logs:</B> kept by our providers for their own periods. Deleted data can remain in backups
            until they roll over.
          </li>
          <li>
            <B>Deleting your account</B> removes your account and the data tied to it. Ask at {LEGAL.contactEmail};
            we aim to do it within {LEGAL.deletionTime}.
          </li>
        </UL>
      </Section>

      <Section id="security" n={7} title="How we protect it">
        <UL>
          <li>Connections are encrypted in transit (HTTPS).</li>
          <li>
            AWS secrets are encrypted before storage (a one-click connection stores no secret), and API keys are
            stored only as hashes.
          </li>
          <li>Each customer’s data is kept separate, and the database isn’t exposed to the public.</li>
          <li>Requests are rate limited, and logs are filtered so they don’t carry message bodies or credentials.</li>
        </UL>
        <p>
          No system is perfectly secure. If a breach affects your data, we will tell you without undue delay. To limit the
          damage of any exposure, connect with one click (no secret is stored) or give us a dedicated IAM user with only the permissions
          we show you, and you can delete the role or user in AWS at any time.
        </p>
      </Section>

      <Section id="cookies" n={8} title="Cookies">
        <p>
          We use only the cookies needed to keep you signed in. We don’t use advertising or tracking cookies, and we
          don’t run third-party analytics on the site.
        </p>
      </Section>

      <Section id="rights" n={9} title="Your choices and rights">
        <UL>
          <li>You can ask us for a copy of your personal data, to correct it, or to delete it. Email {LEGAL.contactEmail}.</li>
          <li>You can revoke our access to your AWS account at any time by deleting the CloudFormation stack or role, or the access key or IAM user.</li>
          <li>You can revoke API keys, remove domains and clear blocked addresses in the dashboard.</li>
          <li>
            Depending on where you live, the law may give you further rights, for example under India’s Digital Personal
            Data Protection Act, 2023, or the GDPR, including the right to complain to a data-protection authority. We
            will respect the rights that apply to you.
          </li>
        </UL>
      </Section>

      <Section id="children" n={10} title="Children">
        <p>The service is for people 18 and over. We don’t knowingly collect data from children.</p>
      </Section>

      <Section id="changes" n={11} title="Changes">
        <p>
          We may update this policy. For material changes we will tell you by email or in the dashboard before they take
          effect. The date at the top shows when it was last changed.
        </p>
      </Section>

      <Section id="contact" n={12} title="Contact">
        <p>
          {LEGAL.operator}
          <br />
          {LEGAL.postalAddress}
          <br />
          {LEGAL.contactEmail}
        </p>
      </Section>
    </LegalPage>
  );
}
