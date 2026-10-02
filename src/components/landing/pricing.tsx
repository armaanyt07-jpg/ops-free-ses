import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { SectionKicker } from "@/components/landing/section-kicker";
import { PricingPlans } from "@/components/pricing/pricing-plans";

export function Pricing() {
  return (
    <section id="pricing" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="08" label="Pricing" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
            Free to start. Pay when you outgrow it.
          </h2>
          <Link
            href="/pricing"
            className="text-primary inline-flex shrink-0 items-center gap-1 text-sm font-medium hover:underline"
          >
            Full pricing and FAQ
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="mt-12">
          <PricingPlans />
        </div>
      </div>
    </section>
  );
}
