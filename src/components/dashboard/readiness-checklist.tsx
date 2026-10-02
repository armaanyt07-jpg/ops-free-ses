import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { readinessSummary, type ReadinessItem } from "@/lib/sandbox/readiness";

/**
 * "Before you submit" (Phase 9). Advisory: nothing here blocks the review step,
 * and an item marked "worth a look" is a suggestion, not a verdict. AWS decides.
 */
export function ReadinessChecklist({ items }: { items: ReadinessItem[] }) {
  const { ok, consider } = readinessSummary(items);

  return (
    <Card id="readiness">
      <CardHeader>
        <CardTitle>Before you submit</CardTitle>
        <CardDescription>
          {consider === 0
            ? "Everything here looks in place."
            : `${consider} thing${consider === 1 ? "" : "s"} worth a look first.`}{" "}
          This is a suggestion, not a verdict: AWS decides, and none of it guarantees an outcome. {ok} of {items.length} in place.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              {item.status === "ok" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-label="In place" />
              ) : (
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-700" aria-label="Worth a look" />
              )}
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="font-medium">
                  {item.label}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {item.status === "ok" ? "In place" : "Worth a look"}
                  </span>
                </p>
                <p className="text-muted-foreground">{item.detail}</p>
                {item.status === "consider" && item.href ? (
                  <Link href={item.href} className="text-foreground text-xs underline underline-offset-4">
                    Go there
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
