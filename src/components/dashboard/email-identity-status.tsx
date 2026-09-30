import { MailCheck } from "lucide-react";

import { checkEmailIdentityNow, deleteEmailIdentity } from "@/app/dashboard/domains/actions";
import { Button } from "@/components/ui/button";
import type { EmailIdentity } from "@/db/schema";

/** A pending or failed address: what to do next, and a way to re-check. */
export function EmailIdentityPending({ identity }: { identity: EmailIdentity }) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="flex items-start gap-2 text-sm">
        <MailCheck className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        {identity.status === "failed" ? (
          <span>
            The confirmation link for <strong>{identity.email}</strong> expired (AWS allows 24
            hours). Remove it and add it again to get a new email.
          </span>
        ) : (
          <span>
            Open the email from Amazon Web Services sent to <strong>{identity.email}</strong> and
            click the confirmation link. Can&apos;t find it? Check spam.
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {identity.status === "pending" ? (
          <form action={checkEmailIdentityNow}>
            <input type="hidden" name="id" value={identity.id} />
            <Button type="submit" size="sm">
              I&apos;ve clicked the link
            </Button>
          </form>
        ) : null}
        <form action={deleteEmailIdentity}>
          <input type="hidden" name="id" value={identity.id} />
          <Button type="submit" variant="ghost" size="sm">
            {identity.status === "failed" ? "Remove" : "Use a different address"}
          </Button>
        </form>
      </div>
    </div>
  );
}
