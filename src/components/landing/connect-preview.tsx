import { Check } from "lucide-react";

import { GREEN } from "@/components/dashboard/badge-tones";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STEPS = [
  { n: "1", title: "Click “Connect AWS”", detail: "Pick your SES region. AWS opens, pre-filled." },
  { n: "2", title: "Click “Create stack”", detail: "AWS creates one IAM role only Ops-Free can use." },
  { n: "3", title: "Connected", detail: "The dashboard updates by itself.", done: true },
];

/**
 * The hero's product picture: the one-click connect, in the dashboard's own
 * vocabulary. Static and illustrative (nothing here is interactive or a real
 * account), so it is hidden from assistive tech and the real facts sit in the
 * hero copy beside it.
 */
export function ConnectPreview() {
  return (
    <div className="relative lg:justify-self-end">
      <div
        aria-hidden
        className="bg-card w-full max-w-sm rounded-xl border shadow-lg ring-1 ring-black/[0.02]"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-red-400/70" />
            <span className="size-2.5 rounded-full bg-amber-400/70" />
            <span className="size-2.5 rounded-full bg-emerald-400/70" />
          </div>
          <p className="text-muted-foreground font-mono text-[0.7rem]">Connect your AWS account</p>
        </div>

        <ol className="divide-y">
          {STEPS.map((s) => (
            <li key={s.n} className="flex items-start gap-3 px-4 py-3.5">
              <span
                className={cn(
                  "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  s.done ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground",
                )}
              >
                {s.done ? <Check className="size-3.5" /> : s.n}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="bg-muted/40 space-y-2 border-t px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">AWS credential</p>
            <Badge variant="secondary" className={cn(GREEN)}>
              active
            </Badge>
          </div>
          <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt>Connected via</dt>
            <dd className="text-foreground font-mono">IAM role</dd>
            <dt>Secret</dt>
            <dd className="text-foreground">none stored · short-lived sessions</dd>
            <dt>Revoke</dt>
            <dd className="text-foreground">delete the stack in AWS</dd>
          </dl>
        </div>
      </div>
      <p className="text-muted-foreground mt-3 text-center text-xs">Illustrative preview of the connect flow.</p>
    </div>
  );
}
