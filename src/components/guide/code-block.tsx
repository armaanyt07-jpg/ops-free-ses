import { CopyButton } from "@/components/dashboard/copy-button";

/** A dark code panel with a copy button; the same look as the dashboard's policy box. */
export function CodeBlock({
  code,
  label,
  copyLabel = "Copy",
}: {
  code: string;
  /** Small caption above the code, such as the language. */
  label?: string;
  copyLabel?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-zinc-950">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-[0.7rem] text-white/50">{label ?? ""}</span>
        <CopyButton text={code} label={copyLabel} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-200">{code}</pre>
    </div>
  );
}
