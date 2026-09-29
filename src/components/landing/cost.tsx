import { Layers } from "lucide-react";

import { SectionKicker } from "@/components/landing/section-kicker";

export function Cost() {
  return (
    <section className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="06" label="Cost model" />
        <div className="grid gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
              Keep AWS SES economics.
              <br />
              Lose the operational overhead.
            </h2>
            <p className="text-muted-foreground mt-5 max-w-xl text-sm leading-relaxed">
              Ops-Free is a developer experience and operations layer on top
              of your own AWS SES account — it sends through your
              credentials and your quota. There&apos;s no separate
              email-sending infrastructure to provision or pay for beyond
              what SES already charges you.
            </p>
            <p className="text-muted-foreground mt-4 max-w-xl text-sm leading-relaxed">
              You keep the AWS bill you&apos;d have anyway. Ops-Free is what
              runs the queue, the retries, the bounce handling and the
              dashboard around it.
            </p>
          </div>

          <div className="relative rounded-2xl border p-6 sm:p-8">
            <div className="space-y-3">
              <div className="bg-primary text-primary-foreground rounded-xl px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <Layers className="size-4" aria-hidden />
                  <p className="text-sm font-semibold">Ops-Free operations layer</p>
                </div>
                <p className="mt-1 text-xs opacity-85">
                  Queueing, retries, bounce/complaint handling, dashboard
                </p>
              </div>
              <div className="flex justify-center">
                <span className="text-muted-foreground/50 font-mono text-xs">runs on ↓</span>
              </div>
              <div className="bg-card rounded-xl border px-5 py-4">
                <p className="text-sm font-semibold">Your AWS account</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Amazon SES usage-based pricing, billed directly by AWS
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
