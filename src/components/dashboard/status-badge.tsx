import { Badge } from "@/components/ui/badge";
import { GREEN, SKY } from "@/components/dashboard/badge-tones";
import { cn } from "@/lib/utils";
import type { EmailStatus } from "@/db/schema";

// Semantic status colour, per the design system: blue for in-flight /
// informational, green for a confirmed successful outcome, red for a
// delivery problem, gray for anything at rest. The status word is always
// present too, so colour is never the only signal.
const VARIANT: Record<
  EmailStatus,
  { variant: "secondary" | "destructive" | "outline"; className?: string }
> = {
  queued: { variant: "secondary" },
  sending: { variant: "secondary", className: SKY },
  sent: { variant: "secondary", className: SKY },
  delivered: { variant: "secondary", className: GREEN },
  bounced: { variant: "destructive" },
  complained: { variant: "destructive" },
  failed: { variant: "destructive" },
  suppressed: { variant: "outline" },
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  const { variant, className } = VARIANT[status];
  return (
    <Badge variant={variant} className={cn(className)}>
      {status}
    </Badge>
  );
}
