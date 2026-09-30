"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { addDomain, type DomainFormState } from "@/app/dashboard/domains/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating SES identity…" : "Add domain"}
    </Button>
  );
}

export function DomainForm() {
  const [state, formAction] = useActionState<DomainFormState, FormData>(
    addDomain,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full flex-1 space-y-2 sm:w-auto sm:min-w-56">
          <Label htmlFor="domain">Domain</Label>
          <Input
            id="domain"
            name="domain"
            placeholder="example.com"
            autoComplete="off"
            spellCheck={false}
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
