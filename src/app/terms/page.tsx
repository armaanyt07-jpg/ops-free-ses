import type { Metadata } from "next";
import Link from "next/link";

import { B, LegalPage, Section, UL } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal/config";

export const metadata: Metadata = {
  title: "Terms of Service — Ops-Free SES",
  description: "The terms for using Ops-Free SES, a developer email API that sends through your own Amazon SES account.",
};

const SECTIONS: Array<[string, string]> = [
  ["service", "The service"],
  ["account", "Your account"],
  ["aws", "Your AWS account"],
  ["acceptable-use", "Acceptable use"],
  ["content", "Your content and your recipients"],
  ["beta", "Beta service, no guarantees"],
  ["fees", "Fees"],
  ["ending", "Suspension and ending"],
  ["liability", "Warranties and liability"],
  ["indemnity", "If a claim is made because of your use"],
  ["changes", "Changes to these terms"],
  ["law", "Governing law"],
  ["contact", "Contact"],
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={`These terms are the agreement between you and ${LEGAL.operator} (“we”, “us”) for using ${LEGAL.product} at ${LEGAL.site}. By creating an account or using the service you agree to them. If you don’t agree, please don’t use it.`}
      sections={SECTIONS}
    >
      <Section id="service" n={1} title="The service">
        <p>
          {LEGAL.product} is a developer tool. It gives you an API and a dashboard for sending email through{" "}
          <B>your own</B> Amazon SES account. You connect your AWS credentials; we queue your messages, send them
          through your SES account, record what happens to them, and help with setup (domains, delivery events, a
          blocked-address list, production-access requests).
        </p>
        <p>
          We are not Amazon, and we are not affiliated with Amazon Web Services. Email is sent by Amazon SES from
          your account, under your agreement with AWS.
        </p>
      </Section>

      <Section id="account" n={2} title="Your account">
        <UL>
          <li>You must be at least 18 and able to enter a binding agreement. If you sign up for a company, you confirm you may bind it.</li>
          <li>Give us accurate details and keep them current.</li>
          <li>
            You are responsible for everything done with your account, your password and your API keys. Keep them
            secret. Tell us promptly at {LEGAL.contactEmail} if you think any of them has been exposed. You can revoke
            an API key in the dashboard at any time.
          </li>
        </UL>
      </Section>

      <Section id="aws" n={3} title="Your AWS account">
        <UL>
          <li>
            You need your own AWS account. You pay AWS directly for what you send. We don’t see, collect or add to your
            AWS bill, and we aren’t responsible for it.
          </li>
          <li>
            You must follow AWS’s own terms and acceptable-use rules, including those for Amazon SES. AWS can suspend or
            limit your account, and that is between you and AWS.
          </li>
          <li>
            New SES accounts start in AWS’s “sandbox”, which limits who you can send to. Whether and when AWS grants
            production access is AWS’s decision. We help you prepare the request; we don’t submit it, and we can’t
            promise or influence the outcome.
          </li>
          <li>
            The access key you give us can do what the policy you attached to it allows. We recommend a dedicated IAM
            user with only the permissions we show you. You can cut off our access at any time by deleting that key or
            user in AWS.
          </li>
        </UL>
      </Section>

      <Section id="acceptable-use" n={4} title="Acceptable use">
        <p>You agree to use the service lawfully and responsibly. In particular, you will <B>not</B>:</p>
        <UL>
          <li>send email to people who haven’t asked to receive it, or to purchased, rented or scraped lists;</li>
          <li>send spam, phishing, malware, scams or deceptive or misleading messages, or anything illegal;</li>
          <li>ignore bounces, complaints or unsubscribe requests, or keep emailing addresses that have asked you to stop;</li>
          <li>break the anti-spam, privacy and marketing laws that apply to you and your recipients;</li>
          <li>send content you don’t have the right to send;</li>
          <li>
            attack, probe or overload the service, try to get around its rate limits or security, access another
            customer’s data, or use it to harm others.
          </li>
        </UL>
        <p>
          The blocked-address list and delivery events are there to help you meet these obligations, but compliance is
          your responsibility, not ours.
        </p>
      </Section>

      <Section id="content" n={5} title="Your content and your recipients">
        <UL>
          <li>You own your content and your data. You give us permission to process it only to provide the service to you (queueing, sending, recording outcomes, support, security).</li>
          <li>
            You are responsible for having the right to email each recipient, including any consent the law requires,
            and for what your messages say. How we handle personal data is described in our{" "}
            <Link href="/privacy" className="text-foreground underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </li>
        </UL>
      </Section>

      <Section id="beta" n={6} title="Beta service, no guarantees">
        <UL>
          <li>The service is in beta. It may change, be interrupted, or have bugs, and we may add or remove features.</li>
          <li>
            There is no uptime or delivery-time guarantee. Messages are queued and sent in the background, and sending
            can take longer than you’d like or be delayed.
          </li>
          <li>
            We can’t guarantee that any email reaches an inbox. Delivery depends on AWS, the recipient’s mail provider,
            and your own sending practices and domain setup.
          </li>
          <li>Keep your own copies of anything important. Don’t rely on the service as your only record.</li>
        </UL>
      </Section>

      <Section id="fees" n={7} title="Fees">
        <p>
          During the beta the service is free. We may introduce paid plans later. If we do, we will tell you in advance
          and you can choose not to continue. Amazon’s charges are separate and are always yours to pay AWS.
        </p>
      </Section>

      <Section id="ending" n={8} title="Suspension and ending">
        <UL>
          <li>
            <B>You</B> can stop at any time: revoke your API keys, delete the IAM user or key in AWS, and email{" "}
            {LEGAL.contactEmail} to have your account deleted (see the Privacy Policy for what that removes).
          </li>
          <li>
            <B>We</B> can suspend or end your access, immediately where needed, if you break these terms, if your use
            puts the service, other customers or recipients at risk, if the law requires it, or if we stop offering the
            service. Where we reasonably can, we will tell you why and give you a chance to fix it.
          </li>
          <li>
            Sections that are meant to continue after the agreement ends (such as liability, indemnity and governing
            law) do.
          </li>
        </UL>
      </Section>

      <Section id="liability" n={9} title="Warranties and liability">
        <UL>
          <li>
            The service is provided <B>“as is” and “as available”</B>. To the fullest extent the law allows, we give no
            warranties, express or implied, including about fitness for a particular purpose, uninterrupted or
            error-free operation, or that email will be delivered.
          </li>
          <li>
            To the fullest extent the law allows, we are not liable for indirect or consequential loss, lost profits,
            lost data, or loss of business or goodwill, or for charges, suspensions or decisions of AWS or any other
            third party.
          </li>
          <li>
            Our total liability to you for all claims relating to the service is limited to the greater of what you paid
            us in the 12 months before the claim and {LEGAL.liabilityFloor}.
          </li>
          <li>Nothing in these terms limits liability that can’t be limited by law.</li>
        </UL>
      </Section>

      <Section id="indemnity" n={10} title="If a claim is made because of your use">
        <p>
          You agree to cover our reasonable losses, costs and legal fees from any third-party claim that arises from your
          content, your recipients or lists, or your breach of these terms or the law. We will tell you about the claim
          promptly and let you help deal with it.
        </p>
      </Section>

      <Section id="changes" n={11} title="Changes to these terms">
        <p>
          We may update these terms. For material changes we will give notice by email or in the dashboard before they
          take effect. If you keep using the service after that, you accept the new terms. If you don’t agree, stop
          using it and ask us to delete your account.
        </p>
      </Section>

      <Section id="law" n={12} title="Governing law">
        <p>
          These terms are governed by {LEGAL.governingLaw}. Any dispute that can’t be settled by talking it through is
          for those courts, unless the law where you live gives you rights that can’t be waived.
        </p>
      </Section>

      <Section id="contact" n={13} title="Contact">
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
