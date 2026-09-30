"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { saveCredential, type CredentialFormState } from "@/app/dashboard/aws/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Validating with AWS…" : "Validate & save"}
    </Button>
  );
}

/**
 * The secret access key input is write-only: it is posted to a Server Action
 * and never rendered back. Stored credentials are displayed elsewhere by
 * access key ID and region only.
 */
export function CredentialForm() {
  const [state, formAction] = useActionState<CredentialFormState, FormData>(
    saveCredential,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">

        <div className="space-y-2">
          <Label htmlFor="awsRegion">AWS region</Label>
          <Input
            id="awsRegion"
            name="awsRegion"
            placeholder="us-east-1"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="accessKeyId">Access key ID</Label>
          <Input
            id="accessKeyId"
            name="accessKeyId"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="secretAccessKey">Secret access key</Label>
          <Input
            id="secretAccessKey"
            name="secretAccessKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>
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

      <p className="text-muted-foreground text-xs">
        The secret is encrypted with AES-256-GCM before it is written to the
        database and is never returned to the browser afterwards.
      </p>

      <Submit />
    </form>
  );
}
