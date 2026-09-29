import { Cloud, FileCode2, Gauge, Globe, Rocket, ShieldOff, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionKicker } from "@/components/landing/section-kicker";

const PROBLEMS: Array<{
  icon: LucideIcon;
  title: string;
  raw: string;
  opsFree: string;
}> = [
  {
    icon: Globe,
    title: "DNS & domain setup",
    raw: "Configure SPF, DKIM, DMARC, domain verification and DNS records manually.",
    opsFree: "Guided domain verification with DNS configuration and verification status in one place.",
  },
  {
    icon: ShieldOff,
    title: "Bounce & complaint handling",
    raw: "A hard bounce or complaint can damage your sending reputation if you don't handle it correctly.",
    opsFree: "Automatically process bounce and complaint events and maintain a suppression list.",
  },
  {
    icon: Gauge,
    title: "Rate limits",
    raw: "SES has account-specific sending quotas and send-rate limits. Burst traffic can result in throttling.",
    opsFree: "Queue outgoing messages and throttle delivery according to your SES sending limits.",
  },
  {
    icon: Rocket,
    title: "AWS sandbox",
    raw: "New SES accounts start with restrictions that make production usage difficult.",
    opsFree: "A guided production-access workflow and preparation checklist.",
  },
  {
    icon: Cloud,
    title: "Infrastructure operations",
    raw: "You have to build the surrounding infrastructure yourself: queues, retries, logs, event processing and monitoring.",
    opsFree: "One API layer for sending, queueing, retries, event tracking and operational visibility.",
  },
  {
    icon: FileCode2,
    title: "Developer experience",
    raw: "You're working directly with AWS APIs and infrastructure primitives.",
    opsFree: "A simple developer API designed around sending email, not operating AWS infrastructure.",
  },
];

export function Problems() {
  return (
    <section id="problem" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="01" label="The problem" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
            Raw SES gives you the infrastructure.
            <br />
            You still have to operate it.
          </h2>
          <p className="text-muted-foreground max-w-sm text-sm">
            Six problems every team hits within the first month of sending
            production email through SES — and how Ops-Free absorbs each one.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PROBLEMS.map((p, i) => {
            const Icon = p.icon;
            return (
              <Card
                key={p.title}
                className="group gap-4 py-6 transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <CardHeader className="px-6">
                  <div className="flex items-start justify-between">
                    <span className="bg-primary/10 text-primary grid size-10 place-items-center rounded-lg">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="text-muted-foreground/40 font-mono text-xs tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <CardTitle className="mt-3 text-base font-semibold">{p.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3.5 px-6 text-sm">
                  <div>
                    <p className="text-muted-foreground text-[0.7rem] font-semibold tracking-wide uppercase">
                      Raw SES
                    </p>
                    <p className="text-muted-foreground mt-1.5 leading-relaxed">{p.raw}</p>
                  </div>
                  <div className="border-t pt-3.5">
                    <p className="text-primary text-[0.7rem] font-semibold tracking-wide uppercase">
                      Ops-Free
                    </p>
                    <p className="mt-1.5 leading-relaxed">{p.opsFree}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
