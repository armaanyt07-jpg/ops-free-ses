"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { reviewSandboxRequest, type ReviewState } from "@/app/dashboard/sandbox/actions";
import { Button } from "@/components/ui/button";

function Confirm() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Recording…" : "I have reviewed this request"}
    </Button>
  );
}

/**
 * The human-review step. All three confirmations are required, and the hash of
 * the exact text on screen is sent with them; the server rejects the review if
 * the text has changed since it was displayed.
 */
export function ReviewForm({ hash }: { hash: string }) {
  const [state, action] = useActionState<ReviewState, FormData>(reviewSandboxRequest, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="hash" value={hash} />
      {(
        [
          ["accurate", "I have read every statement above, and each one is true for my business."],
          ["estimates", "The volumes and quota are my own estimates, not guarantees."],
          ["awsDecides", "I understand AWS alone decides whether to grant production access; this tool cannot and does not."],
        ] as const
      ).map(([name, label]) => (
        <label key={name} className="flex items-start gap-2 text-sm">
          <input type="checkbox" name={name} required className="mt-0.5" />
          {label}
        </label>
      ))}
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <Confirm />
    </form>
  );
}
