import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { signUp } from "@/app/login/actions";

export default function SignupPage() {
  return (
    <AuthShell title="Create an account" description="Bring your own AWS SES credentials.">
      <AuthForm action={signUp} submitLabel="Create account" newAccount />
      <p className="text-muted-foreground text-sm">
        Already registered?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
