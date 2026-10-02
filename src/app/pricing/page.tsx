import type { Metadata } from "next";
import Link from "next/link";

import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { PricingPlans } from "@/components/pricing/pricing-plans";
import { Button } from "@/components/ui/button";
import { getTenant } from "@/server/tenant";

export const metadata: Metadata = {
  title: "Pricing — Ops-Free SES",
  description:
    "Free to start, with Pro and Scale plans for higher volume. You keep paying Amazon for SES directly; Ops-Free is the operations layer on top.",
};

// The nav swaps sign-in for a dashboard link when the visitor is signed in.
export const dynamic = "force-dynamic";

const FAQ: Array<[string, string]> = [
  [
    "What do I pay Amazon on top of this?",
    "Ops-Free sends through your own AWS account, so Amazon bills you directly for SES at its usage-based rate, currently about $0.10 per 1,000 emails. At 50,000 emails a month that is roughly $5 to AWS, on top of the Ops-Free plan. Check AWS's pricing page for the current rate.",
  ],
  [
    "Can I pay for it today?",
    "Not yet. The beta is free and Pro and Scale open once billing is ready. Everyone who signs up during the beta gets 50% off Pro or Scale for as long as they keep the plan.",
  ],
  [
    "How is usage counted?",
    "By emails accepted by the API in each billing period. Messages are counted when we accept them, not when they are delivered.",
  ],
  [
    "What happens when I reach my limit?",
    "You get a warning at 80% of your quota. There is a 10% grace margin past 100%. Beyond that, new sends are rejected with a clear QUOTA_EXCEEDED error before they are queued. Mail we have already accepted is never dropped.",
  ],
  [
    "What if I downgrade or cancel?",
    "Nothing is deleted. A downgrade only stops you adding more than the lower plan allows, and a cancelled paid plan runs until the end of the period you paid for.",
  ],
  [
    "Is the core product really free?",
    "Yes. One-click setup, delivery events, automatic suppression, the API and the dashboard are on every plan, including Free. Paid plans raise volume, identities and history.",
  ],
];

export default async function PricingPage() {
  const signedIn = Boolean(await getTenant());

  return (
    <div className="min-h-screen">
      <LandingNav signedIn={signedIn} />
      <main>
        <section className="border-b">
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Simple pricing on top of your own AWS bill.
            </h1>
            <p className="text-muted-foreground mt-5 max-w-2xl text-base leading-relaxed">
              Ops-Free is the operations layer around Amazon SES: the queue, retries, bounce handling and the dashboard.
              It is free while in beta, and you keep paying Amazon for SES directly.
            </p>
            <div className="mt-12">
              <PricingPlans />
            </div>
          </div>
        </section>

        <section className="border-b">
          <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
            <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>
            <dl className="mt-8 divide-y border-y">
              {FAQ.map(([q, a]) => (
                <div key={q} className="py-6">
                  <dt className="text-sm font-semibold">{q}</dt>
                  <dd className="text-muted-foreground mt-2 text-sm leading-relaxed">{a}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild>
                <Link href={signedIn ? "/dashboard" : "/signup"}>{signedIn ? "Open the dashboard" : "Start free"}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/guide">Read the setup guide</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
