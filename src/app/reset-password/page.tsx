import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { updatePassword } from "@/app/login/actions";

/**
 * Reached from the reset email via `/auth/confirm`, which has already signed
 * the user in. Not a public path: without that session the middleware sends
 * the visitor to sign in instead.
 */
export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" description="At least 8 characters.">
      <AuthForm action={updatePassword} submitLabel="Save new password" fields="new-password" />
    </AuthShell>
  );
}
