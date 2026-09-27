import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { signUp } from "@/app/login/actions";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>
            Bring your own AWS SES credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AuthForm action={signUp} submitLabel="Create account" />
          <p className="text-muted-foreground text-sm">
            Already registered?{" "}
            <Link href="/login" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
