import {
  Activity,
  CheckCircle2,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  Webhook,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GREEN } from "@/components/dashboard/badge-tones";
import { SectionKicker } from "@/components/landing/section-kicker";
import { VolumeChart, type VolumePoint } from "@/components/dashboard/volume-chart";

const STATS = [
  { label: "Accepted", value: "12,480" },
  { label: "Delivered", value: "12,190" },
  { label: "Bounced", value: "142" },
  { label: "Complained", value: "6" },
  { label: "Suppressed", value: "31" },
  { label: "Queue depth", value: "0" },
];

const RAIL = [
  { icon: LayoutDashboard, active: true },
  { icon: Activity, active: false },
  { icon: Globe, active: false },
  { icon: KeyRound, active: false },
  { icon: Webhook, active: false },
  { icon: Gauge, active: false },
];

// Deterministic 14-day sample series — illustrative only, never fetched.
function sampleSeries(): VolumePoint[] {
  const base = Date.UTC(2026, 8, 1);
  const shape = [420, 460, 510, 480, 610, 300, 260, 540, 590, 620, 580, 640, 310, 690];
  return shape.map((total, i) => {
    const delivered = Math.round(total * 0.94);
    const problems = Math.round(total * 0.015);
    const notSent = Math.round(total * 0.01);
    const pending = total - delivered - problems - notSent;
    return {
      start: new Date(base + i * 86_400_000).toISOString(),
      delivered,
      pending: Math.max(0, pending),
      problems,
      notSent,
    };
  });
}

export function DashboardPreview() {
  const series = sampleSeries();

  return (
    <section id="dashboard" className="bg-muted/30 border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="05" label="Product" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
            One dashboard for delivery, domains and keys.
          </h2>
          <p className="text-muted-foreground max-w-sm text-sm">
            Every message, bounce and complaint lands here — alongside domain
            verification, API keys and queue health.
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border bg-white shadow-xl ring-1 ring-black/[0.03] dark:bg-[oklch(0.195_0.014_264)]">
          <div className="flex items-center gap-3 border-b px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-red-400/60" aria-hidden />
              <span className="size-2.5 rounded-full bg-amber-400/60" aria-hidden />
              <span className="size-2.5 rounded-full bg-emerald-400/60" aria-hidden />
            </div>
            <div className="bg-muted text-muted-foreground mx-auto max-w-xs flex-1 rounded-md px-3 py-1 text-center font-mono text-[0.7rem]">
              app.opsfree.dev/dashboard
            </div>
          </div>

          <div className="flex">
            <div className="hidden w-14 shrink-0 flex-col items-center gap-2 border-r py-5 sm:flex">
              {RAIL.map((r, i) => (
                <span
                  key={i}
                  className={
                    r.active
                      ? "bg-primary/10 text-primary grid size-9 place-items-center rounded-lg"
                      : "text-muted-foreground/50 grid size-9 place-items-center rounded-lg"
                  }
                >
                  <r.icon className="size-4" aria-hidden />
                </span>
              ))}
            </div>

            <div className="min-w-0 flex-1 p-5 sm:p-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Overview</p>
                <Badge variant="secondary" className={GREEN}>
                  production
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {STATS.map((s) => (
                  <Card key={s.label} size="sm" className="gap-1 py-3">
                    <CardHeader className="px-3.5">
                      <CardDescription className="text-[0.65rem] font-medium tracking-wide uppercase">
                        {s.label}
                      </CardDescription>
                      <CardTitle className="text-xl font-semibold tracking-tight tabular-nums">
                        {s.value}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                ))}
              </div>

              <Card className="mt-4 gap-3 py-4">
                <CardHeader className="px-5">
                  <CardTitle className="text-sm font-medium">Volume by outcome</CardTitle>
                  <CardDescription className="text-xs">Daily, last 14 days · UTC</CardDescription>
                </CardHeader>
                <CardContent className="px-5">
                  <VolumeChart points={series} hourly={false} />
                </CardContent>
              </Card>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Card size="sm" className="gap-1.5 py-3.5">
                  <CardHeader className="px-3.5">
                    <CardTitle className="text-sm font-medium">Domain verification</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center gap-1.5 px-3.5 text-sm">
                    <CheckCircle2 className="size-4 text-emerald-700" aria-hidden />
                    mail.example.com verified
                  </CardContent>
                </Card>
                <Card size="sm" className="gap-1.5 py-3.5">
                  <CardHeader className="px-3.5">
                    <CardTitle className="text-sm font-medium">API keys</CardTitle>
                  </CardHeader>
                  <CardContent className="text-muted-foreground px-3.5 text-sm">
                    2 active · production &amp; staging
                  </CardContent>
                </Card>
                <Card size="sm" className="gap-1.5 py-3.5">
                  <CardHeader className="px-3.5">
                    <CardTitle className="text-sm font-medium">Queue health</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center gap-1.5 px-3.5 text-sm">
                    <CheckCircle2 className="size-4 text-emerald-700" aria-hidden />
                    Workers healthy
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
        <p className="text-muted-foreground mt-3 text-center text-xs">
          Illustrative preview built from the real dashboard components — your
          account starts empty.
        </p>
      </div>
    </section>
  );
}
