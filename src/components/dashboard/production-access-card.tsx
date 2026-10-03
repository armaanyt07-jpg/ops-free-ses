import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Info } from "lucide-react";

import { AMBER, GREEN, SKY } from "@/components/dashboard/badge-tones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AccessTone, AccessView } from "@/lib/sandbox/access-state";

/**
 * Where the account stands on SES production access (Phase 9). Same words on
 * the Overview, the AWS page and the sandbox page, because they all render the
 * view `describeAccess` builds. Status is never colour alone: icon + label.
 */
const TONE: Record<AccessTone, { icon: typeof Info; label: string; badge: string | undefined }> = {
  neutral: { icon: Info, label: "Sandbox", badge: SKY },
  waiting: { icon: Clock, label: "Waiting", badge: AMBER },
  success: { icon: CheckCircle2, label: "Production", badge: GREEN },
  problem: { icon: AlertTriangle, label: "Needs attention", badge: undefined },
};

export function ProductionAccessCard({
  view,
  compact = false,
}: {
  view: AccessView;
  /** The Overview: a problem becomes one line, and the "while you wait" list a disclosure. */
  compact?: boolean;
}) {
  const tone = TONE[view.tone];
  const Icon = tone.icon;

  // On the Overview a problem (AWS denied, or the request failed) is one line,
  // not a card that pushes the numbers off the screen. Everything it used to
  // show (the summary, the case id, what works meanwhile) is on the page its
  // button opens.
  if (compact && view.tone === "problem") {
    return (
      <div
        data-access-state={view.state}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3"
      >
        <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <p className="text-sm font-medium">{view.title}</p>
        <Badge variant="destructive">{tone.label}</Badge>
        {view.next ? (
          <Button asChild size="sm" className="ml-auto">
            <Link href={view.next.href}>{view.next.label}</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  const waitList =
    view.canDoNow.length > 0 ? (
      <div className="space-y-2">
        <p className="text-sm font-medium">What you can do right now</p>
        <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
          {view.canDoNow.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <Card data-access-state={view.state}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <Icon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {view.title}
              <Badge variant={view.tone === "problem" ? "destructive" : "secondary"} className={tone.badge}>
                {tone.label}
              </Badge>
            </CardTitle>
            <CardDescription className="max-w-3xl">{view.summary}</CardDescription>
            {view.caseId ? (
              <p className="text-muted-foreground text-xs">AWS Support case {view.caseId}</p>
            ) : null}
          </div>
        </div>
      </CardHeader>
      {waitList || view.next ? (
        <CardContent className="space-y-4">
          {waitList ? (
            compact ? (
              <details className="group">
                <summary className="cursor-pointer text-sm font-medium">While you wait: what works</summary>
                <div className="mt-3">{waitList}</div>
              </details>
            ) : (
              waitList
            )
          ) : null}
          {view.next ? (
            <Button asChild variant={view.tone === "problem" ? "default" : "outline"} size="sm">
              <Link href={view.next.href}>{view.next.label}</Link>
            </Button>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
