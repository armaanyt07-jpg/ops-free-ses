import Link from "next/link";

import { EmptyState } from "@/components/dashboard/primitives";

export default function DashboardNotFound() {
  return (
    <div className="py-16">
      <EmptyState title="Not found">
        It may belong to another account, or the link is wrong.{" "}
        <Link href="/dashboard/activity" className="underline underline-offset-4">
          Back to activity
        </Link>
      </EmptyState>
    </div>
  );
}
