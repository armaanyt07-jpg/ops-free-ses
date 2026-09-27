"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { createKey, type ApiKeyFormState } from "@/app/dashboard/api-keys/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create key"}
    </Button>
  );
}

export function ApiKeyForm({
  defaultEnvironment = "staging",
}: {
  defaultEnvironment?: "staging" | "production";
}) {
  const [state, formAction] = useActionState<ApiKeyFormState, FormData>(
    createKey,
    {},
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="flex flex-wrap items-end gap-4">
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="name">Key name</Label>
          <Input id="name" name="name" placeholder="backend-api" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="key-environment">Environment</Label>
          <select
            id="key-environment"
            name="environment"
            defaultValue={defaultEnvironment}
            className="border-input bg-background focus-visible:ring-ring flex h-9 rounded-md border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </div>

        <Submit />
      </form>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {state.secret ? (
        <Alert>
          <AlertTitle>Copy this key now</AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <p>
                This is the only time the secret is shown. Only its hash is
                stored, so it cannot be recovered later.
              </p>
              <code className="bg-muted block w-full rounded px-3 py-2 font-mono text-xs break-all">
                {state.secret}
              </code>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
