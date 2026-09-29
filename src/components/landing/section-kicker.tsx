export function SectionKicker({ index, label }: { index: string; label: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="text-primary font-mono text-xs font-medium tabular-nums">{index}</span>
      <span className="bg-border h-px w-8" aria-hidden />
      <span className="text-muted-foreground text-xs font-medium tracking-[0.15em] uppercase">
        {label}
      </span>
    </div>
  );
}
