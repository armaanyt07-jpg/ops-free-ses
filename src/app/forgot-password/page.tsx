import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { requestPasswordReset } from "@/app/login/actions";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your account's email and we'll send you a link to set a new password."
    >
      <AuthForm action={requestPasswordReset} submitLabel="Send reset link" fields="email" />
      <p className="text-muted-foreground text-sm">
        Remembered it?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
