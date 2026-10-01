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

type Action = (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;

/**
 * The fields each auth page needs:
 * - `credentials`: email + password (sign in, sign up)
 * - `email`: email only (request a password reset)
 * - `new-password`: new password twice (set a new password)
 */
export type AuthFormFields = "credentials" | "email" | "new-password";

export function AuthForm({
  action,
  submitLabel,
  fields = "credentials",
  newAccount = false,
}: {
  action: Action;
  submitLabel: string;
  fields?: AuthFormFields;
  /** Sign-up: lets password managers offer to generate a password. */
  newAccount?: boolean;
}) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {fields !== "new-password" ? (
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
      ) : null}

      {fields === "credentials" ? (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={newAccount ? "new-password" : "current-password"}
            minLength={8}
            required
          />
        </div>
      ) : null}

      {fields === "new-password" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
        </>
      ) : null}

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
