import { Check, X } from "lucide-react";

import { SectionKicker } from "@/components/landing/section-kicker";

const ROWS: Array<[string, string]> = [
  ["DNS configuration", "One API"],
  ["IAM configuration", "Managed queue"],
  ["SES quotas", "Automatic throttling"],
  ["Queue management", "Retries"],
  ["Retry logic", "Bounce handling"],
  ["Bounce processing", "Complaint handling"],
  ["Complaint processing", "Suppression"],
  ["Suppression management", "Delivery tracking"],
  ["SNS configuration", "Dashboard"],
  ["Monitoring", ""],
  ["Production-access request", "Production-access assistant"],
];

export function Comparison() {
  return (
    <section className="bg-muted/30 border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="02" label="Before / after" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
            From AWS infrastructure to an email API.
          </h2>
          <p className="text-muted-foreground max-w-sm text-sm">
            Ops-Free doesn&apos;t remove AWS from the picture — it still sends
            through your own SES account. It removes the part where you build
            and run everything around it.
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border shadow-sm">
          <div className="grid grid-cols-2">
            <div className="bg-card border-r border-b px-6 py-5 sm:px-8">
              <p className="text-sm font-semibold">Raw AWS SES</p>
              <p className="text-muted-foreground mt-0.5 text-xs">What you build and run</p>
            </div>
            <div className="bg-primary text-primary-foreground border-b px-6 py-5 sm:px-8">
              <p className="text-sm font-semibold">Ops-Free SES</p>
              <p className="mt-0.5 text-xs opacity-80">What you get instead</p>
            </div>
          </div>

          {ROWS.map(([raw, opsFree], i) => (
            <div key={raw} className={i % 2 === 1 ? "bg-muted/20 grid grid-cols-2" : "bg-card grid grid-cols-2"}>
              <div className="border-r px-6 py-3.5 text-sm sm:px-8">
                <span className="flex items-center gap-2.5">
                  <X className="text-muted-foreground/60 size-3.5 shrink-0" aria-hidden />
                  <span className="text-muted-foreground">{raw}</span>
                </span>
              </div>
              <div className="bg-primary/[0.04] px-6 py-3.5 text-sm sm:px-8">
                {opsFree ? (
                  <span className="flex items-center gap-2.5">
                    <Check className="text-primary size-3.5 shrink-0" aria-hidden />
                    {opsFree}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
