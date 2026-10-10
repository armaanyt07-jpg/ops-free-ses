import type { Metadata } from "next";

import { Article } from "@/components/marketing/article";
import { A, B, Callout, H2, UL } from "@/components/marketing/prose";
import { postBySlug } from "@/lib/marketing/posts";
import {
  formatUsd,
  opsFreeCost,
  PRICES_CHECKED,
  resendCost,
} from "@/lib/pricing/compare";

const SLUG = "resend-vs-amazon-ses-cost";
const post = postBySlug(SLUG);

export const metadata: Metadata = {
  title: `${post.title} — Ops-Free`,
  description: post.description,
  alternates: { canonical: `/blog/${SLUG}` },
};

export const dynamic = "force-dynamic";

const VOLUMES = [50_000, 100_000, 1_000_000];

export default function Post() {
  const rows = VOLUMES.map((n) => ({
    n,
    ops: opsFreeCost(n),
    resend: resendCost(n),
  }));

  return (
    <Article
      slug={SLUG}
      lede="Amazon SES is the cheapest way to send email at scale, and Resend is one of the easiest. Here is what each costs per month at three volumes, what is and isn't in the price, and when each one is the right call."
      cta="Ops-Free sits on top of your own Amazon SES account, so you keep SES prices and get the bounce handling, suppression and dashboard that make Resend easy. Ops-Free is free."
    >
      <Callout title="Prices checked">
        <p>
          Figures below are from each company&apos;s public pricing page on {PRICES_CHECKED}, in US dollars. Prices
          change, so confirm on{" "}
          <A href="https://resend.com/pricing">resend.com/pricing</A> and{" "}
          <A href="https://aws.amazon.com/ses/pricing/">aws.amazon.com/ses/pricing</A> before you decide.
        </p>
      </Callout>

      <H2 id="numbers">The numbers</H2>
      <p>
        Amazon SES charges $0.10 per 1,000 emails, billed to your AWS account. Resend sells plans with a set number of
        emails included and charges overage past that. For each volume the table uses the cheapest Resend plan that
        covers it.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-sm tabular-nums">
          <thead>
            <tr className="text-foreground border-b text-left">
              <th className="py-2 pr-4 font-semibold">Emails / month</th>
              <th className="py-2 pr-4 font-semibold">SES + Ops-Free</th>
              <th className="py-2 font-semibold">Resend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className="border-b">
                <td className="text-foreground py-2.5 pr-4 font-medium">{r.n.toLocaleString("en-US")}</td>
                <td className="py-2.5 pr-4">{formatUsd(r.ops.total)}</td>
                <td className="py-2.5">{r.resend ? `${formatUsd(r.resend.total)} (${r.resend.tier})` : "Custom"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        The &ldquo;SES + Ops-Free&rdquo; column is Amazon&apos;s sending charge alone, because Ops-Free is free. The
        gap to Resend widens as volume grows. You can try your own volume in the{" "}
        <A href="/tools/ses-cost-calculator">cost calculator</A>.
      </p>

      <H2 id="ses-catch">What SES alone leaves out</H2>
      <p>
        SES on its own is just as cheap, because it only sends. Before it is useful you set up:
      </p>
      <UL>
        <li>An AWS account, IAM permissions and a verified domain with DKIM records.</li>
        <li>Production access, because new accounts start in the sandbox.</li>
        <li>Bounce and complaint handling: a configuration set, an SNS topic and a webhook of your own.</li>
        <li>A suppression list, so you stop emailing addresses that bounced or complained.</li>
        <li>Somewhere to see what was sent and what happened to it.</li>
      </UL>
      <p>
        None of it is hard on its own, and together it is days of work that you then maintain.{" "}
        <A href="/blog/handle-ses-bounces-and-complaints">The bounce and complaint part alone</A> is a long post.
      </p>

      <H2 id="resend-catch">What Resend leaves out</H2>
      <p>
        Resend includes that whole layer: setup, events and a dashboard, behind an API built for developers. You pay for it
        through the per-email plans. That is a fair trade at low volume, where the plan price is small. At larger
        volume the same emails cost many times what Amazon charges for the sending.
      </p>
      <p>
        <B>Where Resend is the better choice:</B> you want no AWS account at all, you send a small volume, or you
        value its features around the API more than the price.
      </p>

      <H2 id="middle">The middle option</H2>
      <p>
        You can keep Amazon&apos;s prices and still skip the setup: a layer on top of your own SES account that handles
        the operations work. That is what Ops-Free is. Your mail is sent by your AWS account, under your agreement with
        Amazon, and Amazon bills you for it directly. Ops-Free is free.
      </p>
      <p>
        The trade-off is real: you still need an AWS account and SES production access. The{" "}
        <A href="/blog/amazon-ses-sandbox-production-access">production access guide</A> covers that part.
      </p>
    </Article>
  );
}
