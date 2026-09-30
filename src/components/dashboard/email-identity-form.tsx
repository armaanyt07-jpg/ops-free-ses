"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { addEmailIdentityAction, type DomainFormState } from "@/app/dashboard/domains/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Asking AWS…" : "Send confirmation email"}
    </Button>
  );
}

/** Phase 8: verify a single sender address instead of a domain. */
export function EmailIdentityForm() {
  const [state, formAction] = useActionState<DomainFormState, FormData>(addEmailIdentityAction, {});

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full flex-1 space-y-2 sm:w-auto sm:min-w-56">
          <Label htmlFor="identity-email">Your email address</Label>
          <Input
            id="identity-email"
            name="email"
            type="email"
            placeholder="you@gmail.com"
            autoComplete="email"
            required
          />
        </div>
        <Submit />
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
