import { cn } from "@/lib/utils";

/**
 * One numbered step of the walkthrough. `id` is the anchor the dashboard's
 * setup screen links to, so renaming one means updating `setup-guide.tsx`.
 */
export function GuideStep({
  id,
  n,
  title,
  badge,
  summary,
  children,
  last = false,
}: {
  id: string;
  n: number;
  title: string;
  badge?: string;
  summary: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li id={id} className="relative flex scroll-mt-24 gap-5 pb-12 last:pb-0">
      {last ? null : <span aria-hidden className="bg-border absolute top-10 bottom-2 left-[15px] w-px" />}
      <span className="bg-card text-primary relative grid size-8 shrink-0 place-items-center rounded-full border font-mono text-xs font-medium tabular-nums">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
          {title}
          {badge ? (
            <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[0.65rem] font-normal">
              {badge}
            </span>
          ) : null}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{summary}</p>
        <div className="mt-4 space-y-4 text-sm leading-relaxed">{children}</div>
      </div>
    </li>
  );
}

/** "You'll know it worked when…": every step ends on something the reader can see. */
export function Done({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-emerald-600/25 bg-emerald-50 px-3.5 py-2.5 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
      <span className="font-medium">You&apos;ll know it worked when </span>
      {children}
    </p>
  );
}

export function Substeps({
  children,
  className,
  start,
}: {
  children: React.ReactNode;
  className?: string;
  /** Continue numbering after something (a code block) interrupted the list. */
  start?: number;
}) {
  return (
    <ol start={start} className={cn("text-muted-foreground list-decimal space-y-2.5 pl-5 marker:text-xs", className)}>
      {children}
    </ol>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="bg-muted/50 text-muted-foreground rounded-lg border px-3.5 py-2.5">{children}</p>
  );
}
