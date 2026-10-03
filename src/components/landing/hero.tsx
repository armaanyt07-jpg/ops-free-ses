import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConnectPreview } from "@/components/landing/connect-preview";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b">
      {/* Restrained technical texture: a faint grid, faded toward the edges,
          with a single soft indigo glow behind the headline — no rainbow
          gradients, no glass, no decorative blobs. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:44px_44px] opacity-[0.35] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black_10%,transparent_75%)]"
      />
      <div
        aria-hidden
        className="bg-primary/10 absolute top-[-12rem] left-1/2 h-[26rem] w-[42rem] -translate-x-1/2 rounded-full blur-3xl"
      />

      <div className="relative mx-auto grid max-w-6xl gap-14 px-6 pt-16 pb-20 sm:pt-24 sm:pb-28 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        <div className="max-w-2xl">
          <div className="border-border bg-background/80 mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur">
            <span className="bg-emerald-500 inline-block size-1.5 rounded-full" aria-hidden />
            New: one-click AWS connect. No access keys to create or store
          </div>

          <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight sm:text-[3.4rem]">
            <span className="sm:whitespace-nowrap">Connect Amazon SES</span>
            <br />
            <span className="text-muted-foreground">in one click.</span>
          </h1>

          <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed text-balance">
            Ops-Free is a Resend/Postmark-style email API and dashboard that
            sends through your own AWS account. Click Create stack in AWS and
            you&apos;re connected: no IAM users to set up, no access keys to
            copy, nothing secret for us to store.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="h-11 px-6 text-sm">
              <Link href="/signup">
                Start Building
                <ArrowUpRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-6 text-sm">
              <a href="#api">View Documentation</a>
            </Button>
          </div>

          <dl className="mt-14 grid max-w-md grid-cols-3 gap-6 border-t pt-6">
            {[
              ["2", "clicks to connect your AWS account"],
              ["0", "access keys stored with one-click connect"],
              ["~1s", "from queued to handed to Amazon SES"],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="text-3xl font-semibold tabular-nums">{value}</dt>
                <dd className="text-muted-foreground mt-1 text-xs leading-snug">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <ConnectPreview />
      </div>
    </section>
  );
}
