"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { revalidate, type RevalidateState } from "@/app/dashboard/aws/actions";
import { Button } from "@/components/ui/button";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Asking AWS…" : "Re-validate"}
    </Button>
  );
}

export function RevalidateButton() {
  const [state, action] = useActionState<RevalidateState>(revalidate, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Submit />
      {state.error ? <p className="max-w-80 text-right text-xs text-red-700 dark:text-red-400">{state.error}</p> : null}
      {state.ok ? <p className="text-muted-foreground text-xs">Updated from AWS.</p> : null}
    </form>
  );
}
