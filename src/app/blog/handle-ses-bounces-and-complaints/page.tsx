import type { Metadata } from "next";

import { CodeBlock } from "@/components/guide/code-block";
import { Article } from "@/components/marketing/article";
import { A, B, Callout, Code, H2, OL, UL } from "@/components/marketing/prose";
import { postBySlug } from "@/lib/marketing/posts";

const SLUG = "handle-ses-bounces-and-complaints";
const post = postBySlug(SLUG);

export const metadata: Metadata = {
  title: `${post.title} — Ops-Free`,
  description: post.description,
  alternates: { canonical: `/blog/${SLUG}` },
};

export const dynamic = "force-dynamic";

const CONFIG_SET = `import { SESv2Client, CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand } from "@aws-sdk/client-sesv2";

const ses = new SESv2Client({ region: "us-east-1" });

await ses.send(new CreateConfigurationSetCommand({ ConfigurationSetName: "app-events" }));

await ses.send(new CreateConfigurationSetEventDestinationCommand({
  ConfigurationSetName: "app-events",
  EventDestinationName: "to-sns",
  EventDestination: {
    Enabled: true,
    MatchingEventTypes: ["BOUNCE", "COMPLAINT", "DELIVERY"],
    SnsDestination: { TopicArn: "arn:aws:sns:us-east-1:111122223333:ses-events" },
  },
}));`;

const TOPIC_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ses.amazonaws.com" },
    "Action": "sns:Publish",
    "Resource": "arn:aws:sns:us-east-1:111122223333:ses-events",
    "Condition": { "StringEquals": { "AWS:SourceAccount": "111122223333" } }
  }]
}`;

const SEND = `import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

await new SESv2Client({ region: "us-east-1" }).send(new SendEmailCommand({
  FromEmailAddress: "hello@example.com",
  Destination: { ToAddresses: ["user@example.org"] },
  Content: { Simple: { Subject: { Data: "Hi" }, Body: { Text: { Data: "Hello" } } } },
  ConfigurationSetName: "app-events", // without this, no events are published
}));`;

const EVENT = `{
  "eventType": "Bounce",
  "mail": { "messageId": "0100018c-...", "destination": ["user@example.org"] },
  "bounce": {
    "bounceType": "Permanent",
    "bounceSubType": "General",
    "bouncedRecipients": [{ "emailAddress": "user@example.org" }]
  }
}`;

export default function Post() {
  return (
    <Article
      slug={SLUG}
      lede="Amazon SES will happily send to an address that bounced yesterday, and keep doing it until your bounce rate gets the account reviewed. Handling bounces and complaints means getting SES to tell you what happened and acting on it. Here is the whole setup and what each piece is for."
      cta="Ops-Free creates the configuration set, the SNS topic and the subscription in your account when you connect AWS. It checks every event's signature, records it against the email, and suppresses bounced and complaining addresses before each send."
    >
      <H2 id="why">Why this matters</H2>
      <p>
        Mailbox providers and AWS both watch two numbers: the share of your mail that bounces and the share that
        recipients mark as spam. AWS puts an account under review when the bounce rate reaches about 5% or the
        complaint rate about 0.1%, and can pause sending if it keeps climbing. Check AWS&apos;s current thresholds, but
        the lesson is the same: you need to know about every bounce and complaint and stop mailing those addresses.
      </p>

      <H2 id="overview">How the pieces fit</H2>
      <OL>
        <li>
          A <B>configuration set</B> with an <B>event destination</B>: tells SES to publish events for mail sent with
          that set.
        </li>
        <li>
          An <B>SNS topic</B> that SES publishes those events to.
        </li>
        <li>
          An <B>HTTPS subscription</B>: SNS posts each event to an endpoint of yours.
        </li>
        <li>
          Your <B>endpoint</B>, which verifies the message, reads the event and updates a suppression list.
        </li>
        <li>
          A <B>check before every send</B> against that list.
        </li>
      </OL>

      <H2 id="topic">1. Create the topic and let SES publish to it</H2>
      <p>
        Create an SNS topic in the same region as your SES identity. Then attach a policy that lets SES publish to it,
        or the event destination in the next step will silently receive nothing:
      </p>
      <CodeBlock code={TOPIC_POLICY} label="SNS topic access policy" />

      <H2 id="config-set">2. Create the configuration set</H2>
      <CodeBlock code={CONFIG_SET} label="TypeScript, AWS SDK v3" />
      <p>
        Send <Code>BOUNCE</Code>, <Code>COMPLAINT</Code> and <Code>DELIVERY</Code> at a minimum. Delivery events let you
        confirm that mail arrived, not only that it failed.
      </p>

      <H2 id="send">3. Send with the configuration set</H2>
      <CodeBlock code={SEND} label="TypeScript, AWS SDK v3" />
      <Callout title="The most common mistake">
        <p>
          A configuration set only applies to messages that name it. Forget <Code>ConfigurationSetName</Code> on one
          code path and its bounces vanish. You can set a default configuration set on the identity to guard against
          this.
        </p>
      </Callout>

      <H2 id="subscribe">4. Subscribe your endpoint</H2>
      <p>
        Subscribe an HTTPS URL to the topic. SNS first sends a <Code>SubscriptionConfirmation</Code> message to that URL,
        and the subscription does nothing until you confirm it, either by calling <Code>ConfirmSubscription</Code> with
        the token or by fetching the <Code>SubscribeURL</Code> it contains. Only confirm messages that pass the check in
        the next step.
      </p>

      <H2 id="verify">5. Verify every message</H2>
      <p>
        Your endpoint is a public URL, so anyone can post to it. SNS signs each message, and you must check the
        signature before trusting anything in it:
      </p>
      <UL>
        <li>
          Require that <Code>SigningCertURL</Code> is HTTPS and its host is an official SNS host such as{" "}
          <Code>sns.us-east-1.amazonaws.com</Code>. Never fetch an arbitrary URL from the message.
        </li>
        <li>
          Rebuild the string to sign from the fields AWS specifies for that message type, in the specified order, and
          check <Code>Signature</Code> against the certificate using the algorithm named by{" "}
          <Code>SignatureVersion</Code>.
        </li>
        <li>Check that the topic ARN is the one you expect.</li>
      </UL>
      <p>
        This is the part most home-built webhooks skip. Without it, anyone who finds the URL can suppress your
        customers or fake bounces.
      </p>

      <H2 id="events">6. Read the event</H2>
      <p>
        SNS wraps the SES event as a JSON string in the <Code>Message</Code> field. After you parse it you get something
        like:
      </p>
      <CodeBlock code={EVENT} label="Bounce event (shortened)" />
      <UL>
        <li>
          <B>Permanent bounce:</B> the address doesn&apos;t exist or can&apos;t receive mail. Suppress it.
        </li>
        <li>
          <B>Transient bounce</B> (full mailbox, temporary failure): don&apos;t suppress on the first one. Retrying
          later can work.
        </li>
        <li>
          <B>Complaint:</B> the recipient marked it as spam. Suppress it immediately, and never email them again.
        </li>
      </UL>
      <p>
        Match each event to your own record of the email with <Code>mail.messageId</Code>, so you can show a user what
        happened to a message.
      </p>

      <H2 id="suppress">7. Suppress before you send</H2>
      <p>
        Store the suppressed addresses (lowercase them) and look each one up before every send, in every code path that
        sends. SES also keeps an account-level suppression list that it can fill automatically for bounces and
        complaints, which is a useful safety net. A list of your own gives you the history and lets you handle it
        per customer.
      </p>

      <H2 id="more">What else you&apos;ll want</H2>
      <UL>
        <li>Make the endpoint idempotent: SNS can deliver the same message more than once.</li>
        <li>Return a 2xx quickly and do the heavy work afterwards, or SNS will retry.</li>
        <li>Alert when your bounce or complaint rate rises, before AWS notices.</li>
        <li>
          Get production access first if you haven&apos;t: the{" "}
          <A href="/blog/amazon-ses-sandbox-production-access">sandbox guide</A> covers it.
        </li>
      </UL>
    </Article>
  );
}
