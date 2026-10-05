"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthFormState } from "@/app/login/actions";
import { PasswordChecklist } from "@/components/auth/password-checklist";
import { TurnstileField } from "@/components/auth/turnstile-field";
import { formNeedsCaptcha, turnstileSiteKey } from "@/lib/auth/captcha";

function SubmitButton({ label, waiting }: { label: string; /** Waiting for the human check to finish. */ waiting: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending || waiting}>
      {pending ? "Working…" : waiting ? "Checking…" : label}
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
  // Bot protection (Cloudflare Turnstile): inert unless a site key is set.
  const protectedForm = Boolean(turnstileSiteKey()) && formNeedsCaptcha(fields);
  const [captchaToken, setCaptchaToken] = useState("");
  // Typed so the requirements checklist can tick off rules as they are met.
  const [password, setPassword] = useState("");

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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={newAccount ? "password-rules" : undefined}
          />
          {newAccount ? <PasswordChecklist id="password-rules" password={password} /> : null}
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="password-rules"
            />
            <PasswordChecklist id="password-rules" password={password} />
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

      {formNeedsCaptcha(fields) ? (
        <>
          <input type="hidden" name="captchaToken" value={captchaToken} />
          <TurnstileField onToken={setCaptchaToken} resetSignal={state} />
        </>
      ) : null}

      <SubmitButton label={submitLabel} waiting={protectedForm && !captchaToken} />
    </form>
  );
}
