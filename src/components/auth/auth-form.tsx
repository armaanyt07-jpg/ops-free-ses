"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthFormState } from "@/app/login/actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export function AuthForm({
  action,
  submitLabel,
}: {
  action: (
    prev: AuthFormState,
    formData: FormData,
  ) => Promise<AuthFormState>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
        />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {state.notice ? (
        <Alert>
          <AlertDescription>{state.notice}</AlertDescription>
        </Alert>
      ) : null}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
