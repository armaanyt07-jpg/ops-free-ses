import { Badge } from "@/components/ui/badge";
import type { DomainStatus } from "@/db/schema";
import type { CheckStatus } from "@/lib/dns/checks";

const CHECK_VARIANT: Record<
  CheckStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pass: "default",
  warn: "outline",
  fail: "destructive",
  unknown: "secondary",
};

export function CheckBadge({ status }: { status: CheckStatus }) {
  return <Badge variant={CHECK_VARIANT[status]}>{status}</Badge>;
}

const DOMAIN_VARIANT: Record<
  DomainStatus,
  "default" | "secondary" | "destructive"
> = {
  verified: "default",
  pending: "secondary",
  failed: "destructive",
};

export function DomainStatusBadge({ status }: { status: DomainStatus }) {
  return <Badge variant={DOMAIN_VARIANT[status]}>{status}</Badge>;
}
