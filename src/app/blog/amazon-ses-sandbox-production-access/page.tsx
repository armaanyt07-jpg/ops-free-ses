import type { Metadata } from "next";

import { Article } from "@/components/marketing/article";
import { A, B, Callout, Code, H2, H3, OL, UL } from "@/components/marketing/prose";
import { postBySlug } from "@/lib/marketing/posts";

const SLUG = "amazon-ses-sandbox-production-access";
const post = postBySlug(SLUG);

export const metadata: Metadata = {
  title: `${post.title} — Ops-Free`,
  description: post.description,
  alternates: { canonical: `/blog/${SLUG}` },
};

export const dynamic = "force-dynamic";

export default function Post() {
  return (
    <Article
      slug={SLUG}
      lede="Every new Amazon SES account starts in the sandbox, and nothing you build will reach a real customer until AWS lets you out. The request is a short form, and a lot of them are refused. This is what the sandbox limits, what AWS wants to see, and how to write the request."
      cta="Ops-Free's request assistant is built into the dashboard. It includes only what it has actually measured, such as your verified domains and whether bounce handling is live, and it never claims AWS will approve you."
    >
      <H2 id="sandbox">What the sandbox limits</H2>
      <p>In the sandbox, SES lets you:</p>
      <UL>
        <li>
          Send <B>only to addresses you have verified</B>, plus the SES mailbox simulator. A customer&apos;s address
          won&apos;t work.
        </li>
        <li>Send a small daily quota, typically 200 messages in 24 hours.</li>
        <li>Send about one message per second.</li>
      </UL>
      <p>
        The sandbox is per region. Getting out in <Code>us-east-1</Code> does nothing for <Code>eu-west-1</Code>, so
        request access in the region you actually send from.
      </p>

      <H2 id="before">Before you ask</H2>
      <p>Reviewers are checking that you are a legitimate sender who will handle problems. Have these ready first:</p>
      <OL>
        <li>
          <B>A verified domain you own</B> with all three DKIM records published. Check it with the free{" "}
          <A href="/tools/ses-dns-checker">SES DNS checker</A>. A verified sender is a stronger request than a bare
          email address.
        </li>
        <li>
          <B>A working website</B> that matches what you say you send. Reviewers do visit it.
        </li>
        <li>
          <B>A plan for bounces and complaints.</B> Ideally this is already running, which is the{" "}
          <A href="/blog/handle-ses-bounces-and-complaints">SNS setup in the next post</A>. If it isn&apos;t, say
          honestly what you will build rather than implying it exists.
        </li>
      </OL>

      <H2 id="form">What the form asks</H2>
      <p>In the SES console, open the Account dashboard and choose Request production access. The fields are:</p>
      <UL>
        <li>
          <B>Mail type:</B> Transactional (sent because of something a user did) or Marketing (promotional or bulk).
        </li>
        <li>
          <B>Website URL.</B>
        </li>
        <li>
          <B>Use case description:</B> the part that decides the outcome.
        </li>
        <li>
          <B>Additional contact addresses</B> and a contact language.
        </li>
      </UL>
      <p>AWS usually replies within about a day, and the answer arrives as a support case.</p>

      <H2 id="write">Writing the use case</H2>
      <p>A good description answers the questions a reviewer would otherwise have to ask you:</p>
      <UL>
        <li>
          <B>What do you send, and what triggers it?</B> &ldquo;Password reset and order confirmation emails, sent when a
          user requests one&rdquo; is clear. &ldquo;Emails to customers&rdquo; is not.
        </li>
        <li>
          <B>How many, and how fast?</B> Give honest estimates per day and your peak rate.
        </li>
        <li>
          <B>How do you get recipients&apos; addresses?</B> Sign-up, checkout and double opt-in are good answers.
          Purchased or scraped lists are against the AWS Acceptable Use Policy and are refused.
        </li>
        <li>
          <B>How do you handle bounces and complaints?</B> Name the mechanism: SNS notifications, a suppression list, and
          what you do with each.
        </li>
        <li>
          <B>For marketing mail, how do people unsubscribe?</B>
        </li>
      </UL>
      <p>
        If you&apos;d rather not start from a blank page, the free{" "}
        <A href="/tools/ses-production-access">request writer</A> asks these exact questions and assembles your answers
        into a request. It runs in your browser and adds nothing you didn&apos;t type.
      </p>

      <H2 id="denied">If you are denied</H2>
      <p>
        A denial is not final. AWS replies in the same support case, and you can answer and reopen it. Read the reply
        for what they objected to, fix that specific thing and respond with the change. Common causes:
      </p>
      <UL>
        <li>The description was too vague. Rewrite it with the specifics above.</li>
        <li>Bounce and complaint handling was missing or only promised.</li>
        <li>The website didn&apos;t match the use case, or wasn&apos;t live.</li>
        <li>The recipient list sounded purchased, rented or scraped.</li>
      </UL>
      <Callout title="Don't exaggerate">
        <p>
          Don&apos;t inflate volumes or claim compliance programs you don&apos;t have. If your sending later looks
          different from what you wrote, AWS can pause the account, which is worse than a denial.
        </p>
      </Callout>

      <H3>After approval</H3>
      <p>
        Your quota rises and the recipient restriction goes away, but a new quota is still limited. Watch your bounce
        and complaint rates from day one: AWS reviews accounts whose rates run high, and handling both automatically is
        what keeps you in good standing.
      </p>
    </Article>
  );
}
