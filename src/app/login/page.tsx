import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  const { link } = await searchParams;

  return (
    <AuthShell title="Sign in" description="Ops-Free SES Engine control plane.">
      {link === "failed" ? (
        <Alert>
          <AlertDescription>
            That link has expired or was opened in a different browser. If you were confirming
            your email, it may already be confirmed: try signing in. If you were resetting your
            password, request a new link and open it in this browser.
          </AlertDescription>
        </Alert>
      ) : null}
      <AuthForm action={signIn} submitLabel="Sign in" />
      <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-sm">
        <p>
          No account?{" "}
          <Link href="/signup" className="underline underline-offset-4">
            Create one
          </Link>
        </p>
        <Link href="/forgot-password" className="underline underline-offset-4">
          Forgot password?
        </Link>
      </div>
    </AuthShell>
  );
}
