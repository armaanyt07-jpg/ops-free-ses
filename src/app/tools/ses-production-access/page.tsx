import type { Metadata } from "next";

import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { A, B, H2, MarketingMain, PageHeader, Prose, SkipItCta, UL } from "@/components/marketing/prose";
import { ProductionAccessWriter } from "@/components/tools/production-access-writer";
import { getTenant } from "@/server/tenant";

export const metadata: Metadata = {
  title: "Amazon SES production access request writer — Ops-Free",
  description:
    "Free tool: answer a few questions and get a clear, honest request to move your Amazon SES account out of the sandbox. Runs in your browser.",
  alternates: { canonical: "/tools/ses-production-access" },
};

export const dynamic = "force-dynamic";

export default async function ProductionAccessPage() {
  const signedIn = Boolean(await getTenant());
  return (
    <div className="min-h-screen">
      <LandingNav signedIn={signedIn} />
      <MarketingMain>
        <PageHeader
          kicker="Free tool"
          title="SES production access request writer"
          lede="New SES accounts start in the sandbox: you can only email verified addresses, up to 200 a day. AWS decides who gets out, and vague requests get refused. Answer these questions and get a clear request you can paste into the console."
        />
        <ProductionAccessWriter />

        <Prose>
          <H2 id="how">How this works</H2>
          <p>
            <B>Nothing is invented.</B> The request is built only from your answers, in your words, with plain section
            headings. Blank questions are left out rather than filled in, and it never claims that AWS will approve you.
            It runs in your browser, so your answers aren&apos;t sent to us.
          </p>

          <H2 id="why-denied">Why requests get denied</H2>
          <UL>
            <li>A use case that says &ldquo;sending emails to customers&rdquo; and nothing else.</li>
            <li>No answer for bounces and complaints. AWS wants to see you&apos;ll handle both.</li>
            <li>Purchased or scraped lists. These are against the AWS Acceptable Use Policy and are routinely refused.</li>
            <li>No working website, or a site that doesn&apos;t match the use case.</li>
          </UL>
          <p>
            Check that your domain&apos;s records are right first with the{" "}
            <A href="/tools/ses-dns-checker">SES DNS checker</A>: reviewers look for an authenticated sender.
          </p>
        </Prose>

        <SkipItCta title="Have Ops-Free fill in the facts">
          Inside Ops-Free the same assistant can include things it has actually measured, like your verified domains and
          whether bounce handling is live. It only includes what&apos;s true.
        </SkipItCta>
      </MarketingMain>
      <LandingFooter />
    </div>
  );
}
