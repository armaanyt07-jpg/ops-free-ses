"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  addSuppressionAction,
  removeSuppressionAction,
  type SuppressionFormState,
} from "@/app/dashboard/suppressions/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit({ idle, busy, variant }: { idle: string; busy: string; variant?: "default" | "destructive" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant ?? "default"} disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

export function AddSuppressionForm() {
  const [state, action] = useActionState<SuppressionFormState, FormData>(addSuppressionAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="sup-email">Address</Label>
          <Input id="sup-email" name="email" type="email" placeholder="someone@example.com" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sup-note">Reason (recorded)</Label>
          <Input id="sup-note" name="note" placeholder="e.g. requested removal by email" required />
        </div>
        <Submit idle="Suppress" busy="Saving…" />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.success ? (
        <Alert>
          <AlertDescription>{state.success}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}

/**
 * Unsuppressing an address that hard-bounced sends mail back into a mailbox
 * that rejected it, so it takes a second, deliberate step and a reason.
 */
export function RemoveSuppressionForm({ email, reason }: { email: string; reason: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<SuppressionFormState, FormData>(removeSuppressionAction, {});

  if (state.success) {
    return <span className="text-muted-foreground text-xs">{state.success}</span>;
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Remove
      </Button>
    );
  }

  return (
    <form action={action} className="ml-auto flex max-w-sm flex-col items-stretch gap-2 text-left">
      <input type="hidden" name="email" value={email} />
      {reason === "hard_bounce" || reason === "complaint" ? (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          This address {reason === "complaint" ? "complained" : "hard-bounced"}. Sending to it
          again can hurt your SES reputation.
        </p>
      ) : null}
      <Input name="note" placeholder="Reason (recorded in the audit log)" required aria-label="Reason" />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Submit idle="Remove" busy="Removing…" variant="destructive" />
      </div>
      {state.error ? <p className="text-xs text-red-700 dark:text-red-400">{state.error}</p> : null}
    </form>
  );
}
