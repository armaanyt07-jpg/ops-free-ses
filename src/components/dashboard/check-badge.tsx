import { Badge } from "@/components/ui/badge";
import { GREEN, AMBER } from "@/components/dashboard/badge-tones";
import { cn } from "@/lib/utils";
import type { DomainStatus } from "@/db/schema";
import type { CheckStatus } from "@/lib/dns/checks";

// Green = verified/passing, amber = pending/warning, red (destructive) = failed,
// gray = unknown, per the design system's semantic colour scale.
const CHECK_VARIANT: Record<
  CheckStatus,
  { variant: "secondary" | "destructive"; className?: string }
> = {
  pass: { variant: "secondary", className: GREEN },
  warn: { variant: "secondary", className: AMBER },
  fail: { variant: "destructive" },
  unknown: { variant: "secondary" },
};

export function CheckBadge({ status }: { status: CheckStatus }) {
  const { variant, className } = CHECK_VARIANT[status];
  return (
    <Badge variant={variant} className={cn(className)}>
      {status}
    </Badge>
  );
}

const DOMAIN_VARIANT: Record<
  DomainStatus,
  { variant: "secondary" | "destructive"; className?: string }
> = {
  verified: { variant: "secondary", className: GREEN },
  pending: { variant: "secondary", className: AMBER },
  failed: { variant: "destructive" },
};

export function DomainStatusBadge({ status }: { status: DomainStatus }) {
  const { variant, className } = DOMAIN_VARIANT[status];
  return (
    <Badge variant={variant} className={cn(className)}>
      {status}
    </Badge>
  );
}
