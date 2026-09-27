"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { rotateKey, type RotateKeyState } from "@/app/dashboard/api-keys/actions";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dashboard/format";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Rotating…" : "Rotate"}
    </Button>
  );
}

/**
 * Rotation issues a replacement and gives the old key a deadline, so services
 * can move to the new key before the old one stops working.
 */
export function RotateKeyForm({ keyId, name }: { keyId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<RotateKeyState, FormData>(rotateKey, {});

  if (state.secret) {
    return (
      <div className="bg-muted/50 space-y-2 rounded-md border p-3 text-left text-sm">
        <p className="font-medium">New key for “{name}” — copy it now</p>
        <code className="bg-background block rounded px-2 py-1.5 font-mono text-xs break-all select-all">
          {state.secret}
        </code>
        <p className="text-muted-foreground text-xs">
          {state.immediate
            ? "The old key was revoked immediately."
            : `The old key keeps working until ${formatDateTime(new Date(state.oldKeyExpiresAt!))}.`}{" "}
          This secret is not shown again.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Rotate
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="id" value={keyId} />
      <label htmlFor={`grace-${keyId}`} className="text-muted-foreground text-xs">
        Old key stops
      </label>
      <select
        id={`grace-${keyId}`}
        name="grace"
        defaultValue="24h"
        className="border-input bg-background h-8 rounded-md border px-2 text-xs"
      >
        <option value="now">immediately</option>
        <option value="1h">in 1 hour</option>
        <option value="24h">in 24 hours</option>
        <option value="7d">in 7 days</option>
      </select>
      <Submit />
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state.error ? <p className="w-full text-right text-xs text-red-700">{state.error}</p> : null}
    </form>
  );
}
