import type { Metadata } from "next";

import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { A, B, H2, MarketingMain, PageHeader, Prose, SkipItCta } from "@/components/marketing/prose";
import { CostCalculator } from "@/components/tools/cost-calculator";
import { getTenant } from "@/server/tenant";

export const metadata: Metadata = {
  title: "Email API cost calculator: Amazon SES vs Resend — Ops-Free",
  description:
    "Free calculator: the real monthly cost of sending email with Amazon SES and Ops-Free, compared with Resend, at any volume.",
  alternates: { canonical: "/tools/ses-cost-calculator" },
};

export const dynamic = "force-dynamic";

export default async function CostCalculatorPage() {
  const signedIn = Boolean(await getTenant());
  return (
    <div className="min-h-screen">
      <LandingNav signedIn={signedIn} />
      <MarketingMain>
        <PageHeader
          kicker="Free tool"
          title="What does email cost at your volume?"
          lede="Enter how many emails you send a month. See what Amazon SES with Ops-Free costs, and what Resend costs for the same volume."
        />
        <CostCalculator />

        <Prose>
          <H2 id="how">How the numbers work</H2>
          <p>
            <B>Ops-Free sends through your own AWS account.</B> Amazon bills you $0.10 per 1,000 emails directly. Ops-Free
            is free and adds nothing on top, so what you pay is Amazon&apos;s sending charge.
          </p>
          <p>
            <B>Resend includes sending in its plan price</B>, so its cost steps up as your volume grows. That is why the
            gap widens the more you send.
          </p>
          <p>
            Raw SES alone is cheaper than both, but you build the bounce handling, suppression and monitoring yourself.
            See <A href="/blog/resend-vs-amazon-ses-cost">Resend vs Amazon SES: the real cost</A> for what that involves.
          </p>
        </Prose>

        <SkipItCta title="Keep SES prices without the setup">
          Connect your AWS account in one click and get delivery events, automatic suppression and a dashboard on top of SES.
        </SkipItCta>
      </MarketingMain>
      <LandingFooter />
    </div>
  );
}
