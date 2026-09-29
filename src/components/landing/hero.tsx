import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";

const FEED = [
  { status: "delivered" as const, to: "user@example.com", subject: "Welcome to Acme", time: "2s ago" },
  { status: "delivered" as const, to: "hi@stripe.com", subject: "Your invoice is ready", time: "14s ago" },
  { status: "sent" as const, to: "team@vercel.com", subject: "Password reset", time: "31s ago" },
  { status: "queued" as const, to: "founder@ycombinator.com", subject: "Weekly digest", time: "now" },
];

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
            Built on Amazon SES — your AWS account, your credentials
          </div>

          <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl">
            AWS SES is cheap.
            <br />
            <span className="text-muted-foreground">Operating it isn&apos;t.</span>
          </h1>

          <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed text-balance">
            Ops-Free gives developers a Resend/Postmark-style email
            infrastructure layer powered by AWS SES — without forcing you to
            manage the operational complexity yourself.
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
              ["1", "API to send, track and troubleshoot email"],
              ["6", "operational problems handled automatically"],
              ["0", "extra infrastructure for you to run"],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="text-3xl font-semibold tabular-nums">{value}</dt>
                <dd className="text-muted-foreground mt-1 text-xs leading-snug">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Product visualization: a live-looking activity feed, the same
            status vocabulary and component as the real dashboard. */}
        <div className="relative lg:justify-self-end">
          <div className="bg-card w-full max-w-sm rounded-xl border shadow-lg ring-1 ring-black/[0.02]">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-red-400/70" aria-hidden />
                <span className="size-2.5 rounded-full bg-amber-400/70" aria-hidden />
                <span className="size-2.5 rounded-full bg-emerald-400/70" aria-hidden />
              </div>
              <p className="text-muted-foreground font-mono text-[0.7rem]">Live activity</p>
            </div>
            <ul className="divide-y">
              {FEED.map((row) => (
                <li key={row.subject} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <StatusBadge status={row.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.subject}</p>
                    <p className="text-muted-foreground truncate text-xs">→ {row.to}</p>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">{row.time}</span>
                </li>
              ))}
            </ul>
            <div className="text-muted-foreground grid grid-cols-3 gap-2 border-t px-4 py-3 text-center text-xs">
              <div>
                <p className="text-foreground text-sm font-semibold tabular-nums">99.2%</p>
                delivered
              </div>
              <div>
                <p className="text-foreground text-sm font-semibold tabular-nums">0.3%</p>
                bounce rate
              </div>
              <div>
                <p className="text-foreground text-sm font-semibold tabular-nums">142ms</p>
                p50 accept
              </div>
            </div>
          </div>
          <p className="text-muted-foreground mt-3 text-center text-xs">
            Illustrative preview — your account starts empty.
          </p>
        </div>
      </div>
    </section>
  );
}
