import Link from "next/link";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ANNUAL_MONTHS_BILLED,
  FOUNDING_DISCOUNT_PERCENT,
  INCLUDED_EVERYWHERE,
  PAID_PLANS_OPEN,
  PLANS,
  annualPrice,
  type Plan,
} from "@/lib/pricing/plans";
import { cn } from "@/lib/utils";

function PlanCard({ plan }: { plan: Plan }) {
  const free = plan.monthly === 0;
  const open = free || PAID_PLANS_OPEN;

  return (
    <div
      data-plan={plan.id}
      className={cn(
        "bg-card relative flex flex-col rounded-2xl border p-6 sm:p-7",
        plan.highlight && "border-primary ring-primary/20 shadow-sm ring-4",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{plan.name}</h3>
        {!open ? (
          <span className="text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 text-[11px] font-medium">
            Opens after beta
          </span>
        ) : null}
      </div>

      <p className="mt-5 flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tracking-tight tabular-nums">${plan.monthly}</span>
        <span className="text-muted-foreground text-sm">/ month</span>
      </p>
      <p className="text-muted-foreground mt-1 h-5 text-xs tabular-nums">
        {free ? "No card needed" : `or $${annualPrice(plan.monthly)} / year — ${12 - ANNUAL_MONTHS_BILLED} months free`}
      </p>

      <p className="text-muted-foreground mt-4 text-sm leading-relaxed">{plan.blurb}</p>

      <p className="mt-5 border-t pt-5 text-sm font-semibold tabular-nums">{plan.emails}</p>
      <ul className="mt-3 space-y-2.5 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8 pt-2 sm:mt-auto">
        {open ? (
          <Button asChild variant={plan.highlight ? "default" : "outline"} className="w-full">
            <Link href="/signup">{free ? "Start free" : `Choose ${plan.name}`}</Link>
          </Button>
        ) : (
          <Button variant="outline" className="w-full" disabled>
            Opens after beta
          </Button>
        )}
      </div>
    </div>
  );
}

/** The plan cards (Free and Pro), the shared inclusions and the founding-member note. */
export function PricingPlans() {
  return (
    <div>
      {!PAID_PLANS_OPEN ? (
        <p className="bg-muted/40 mb-6 rounded-xl border px-5 py-3.5 text-sm leading-relaxed">
          <span className="font-semibold">For now, everything is free.</span>{" "}
          <span className="text-muted-foreground">
            There are no limits during the beta. These are the plans we&apos;re planning for when paid plans open.
          </span>
        </p>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2 lg:max-w-4xl">
        {PLANS.map((p) => (
          <PlanCard key={p.id} plan={p} />
        ))}
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border p-6">
          <p className="text-sm font-semibold">On every plan</p>
          <ul className="mt-3 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
            {INCLUDED_EVERYWHERE.map((f) => (
              <li key={f} className="flex gap-2.5">
                <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-muted/40 rounded-2xl border p-6">
          <p className="text-sm font-semibold">Founding-member rate</p>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Everyone who signs up during the beta gets {FOUNDING_DISCOUNT_PERCENT}% off Pro for as long as they
            keep the plan, once paid plans open. The beta is free in the meantime.
          </p>
        </div>
      </div>

      <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
        Prices are in US dollars. Amazon charges for SES separately, directly to your AWS account.
      </p>
    </div>
  );
}
