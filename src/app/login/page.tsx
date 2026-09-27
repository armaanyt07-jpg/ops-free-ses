import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
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
    </main>
  );
}
