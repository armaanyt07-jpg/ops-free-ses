import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { Wordmark } from "@/components/brand/wordmark";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { signIn } from "./actions";

export default function LoginPage() {
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center">
          <Wordmark />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Ops-Free SES Engine control plane.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AuthForm action={signIn} submitLabel="Sign in" />
            <p className="text-muted-foreground text-sm">
              No account?{" "}
              <Link href="/signup" className="underline underline-offset-4">
                Create one
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
