import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Code2,
  Gauge,
  LayoutDashboard,
  Mail,
  Webhook,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { SectionKicker } from "@/components/landing/section-kicker";

interface Node {
  icon: LucideIcon;
  label: string;
  sub?: string;
}

const SEND_PATH: Node[] = [
  { icon: Code2, label: "Your application" },
  { icon: Zap, label: "Ops-Free API", sub: "POST /api/v1/send" },
  { icon: Gauge, label: "Queue & rate limiter" },
  { icon: Cloud, label: "AWS SES", sub: "your account" },
  { icon: Mail, label: "Recipient" },
];

const EVENT_PATH: Node[] = [
  { icon: Cloud, label: "AWS SES" },
  { icon: Webhook, label: "SNS events" },
  { icon: Zap, label: "Ops-Free webhook" },
  { icon: CheckCircle2, label: "Delivery / bounce / complaint" },
  { icon: LayoutDashboard, label: "Dashboard & blocked addresses" },
];

function DiagramNode({ node }: { node: Node }) {
  const Icon = node.icon;
  return (
    <div className="bg-card flex w-full shrink-0 flex-col items-center gap-2 rounded-xl border px-4 py-4 text-center shadow-xs sm:w-36">
      <span className="bg-primary/10 text-primary grid size-9 place-items-center rounded-lg">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <div>
        <p className="text-sm leading-tight font-medium">{node.label}</p>
        {node.sub ? (
          <p className="text-muted-foreground mt-0.5 font-mono text-[0.65rem] leading-tight">
            {node.sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Diagram({ nodes }: { nodes: Node[] }) {
  return (
    <div className="flex flex-col items-stretch gap-0 sm:flex-row sm:items-center">
      {nodes.map((node, i) => (
        <div key={node.label} className="flex flex-col items-center sm:contents">
          {i > 0 ? (
            <>
              <div className="flex items-center justify-center py-1.5 sm:hidden">
                <ArrowDown className="text-muted-foreground/50 size-4" aria-hidden />
              </div>
              <div className="text-muted-foreground/40 hidden min-w-6 flex-1 items-center justify-center sm:flex">
                <span className="border-border h-px w-full border-t border-dashed" aria-hidden />
                <ArrowRight className="mx-1 size-4 shrink-0" aria-hidden />
              </div>
            </>
          ) : null}
          <DiagramNode node={node} />
        </div>
      ))}
    </div>
  );
}

export function Flow() {
  return (
    <section id="how-it-works" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <SectionKicker index="03" label="Architecture" />
        <h2 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-[2.75rem]">
          How it works.
        </h2>
        <p className="text-muted-foreground mt-3 max-w-xl text-sm">
          Two paths through the system: sending a message, and receiving
          delivery events back from SES.
        </p>

        <div className="relative mt-14 overflow-hidden rounded-2xl border">
          <div
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:28px_28px] opacity-60"
          />
          <div className="relative space-y-12 p-6 sm:p-10">
            <div>
              <p className="text-muted-foreground mb-6 text-xs font-semibold tracking-[0.15em] uppercase">
                Sending
              </p>
              <Diagram nodes={SEND_PATH} />
            </div>
            <div className="border-t pt-10">
              <p className="text-muted-foreground mb-6 text-xs font-semibold tracking-[0.15em] uppercase">
                Events
              </p>
              <Diagram nodes={EVENT_PATH} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
