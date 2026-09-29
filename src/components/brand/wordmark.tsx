import { LogoMark } from "@/components/brand/logo-mark";
import { cn } from "@/lib/utils";

/** The site's one logo lockup — used in the landing nav/footer, auth pages and dashboard chrome. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark className="size-7" />
      <span className="flex items-baseline gap-1.5">
        <span className="text-foreground text-sm font-semibold">Ops-Free</span>
        <span className="bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] bg-clip-text text-[0.65rem] font-bold tracking-[0.2em] text-transparent uppercase">
          SES
        </span>
      </span>
    </span>
  );
}
