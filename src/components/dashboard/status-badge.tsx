import { Badge } from "@/components/ui/badge";
import type { EmailStatus } from "@/db/schema";

const VARIANT: Record<
  EmailStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "secondary",
  sending: "secondary",
  sent: "default",
  delivered: "default",
  bounced: "destructive",
  complained: "destructive",
  failed: "destructive",
  suppressed: "outline",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return <Badge variant={VARIANT[status]}>{status}</Badge>;
}
