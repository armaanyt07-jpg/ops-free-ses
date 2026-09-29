import { Building2, Cloud, Code2, Rocket, ShieldCheck, Terminal, type LucideIcon } from "lucide-react";

import { SectionKicker } from "@/components/landing/section-kicker";

const AUDIENCE: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Code2,
    title: "SaaS developers",
    body: "Transactional email — welcome, password reset, invoices — without owning bounce processing.",
  },
  {
    icon: Rocket,
    title: "Indie hackers",
    body: "Production email infrastructure without the time cost of building queues and retry logic solo.",
  },
  {
    icon: Building2,
    title: "Startups",
    body: "Start on SES economics from day one, with the operational layer already handled.",
  },
  {
    icon: Terminal,
    title: "Backend engineers",
    body: "An API that matches how you already think about sending mail, not an AWS SDK to wrap yourself.",
  },
  {
    icon: Cloud,
    title: "Teams on AWS already",
    body: "Keep credentials and delivery inside your own AWS account — Ops-Free doesn't ask you to leave it.",
  },
  {
    icon: ShieldCheck,
    title: "Anyone tired of reputation risk",
    body: "Suppression and complaint handling run automatically, before a bad send touches your sender reputation.",
  },
];

export function Audience() {
  return (
    <section id="audience" className="bg-muted/30 border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="07" label="Who it's for" />
        <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
          Built for people already shipping on AWS.
        </h2>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCE.map((a) => (
            <div key={a.title} className="bg-background p-6">
              <a.icon className="text-primary size-5" aria-hidden />
              <p className="mt-3 text-sm font-semibold">{a.title}</p>
              <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{a.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
