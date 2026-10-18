import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SERVICE_PAUSED } from "@/lib/service-status";

/** The centred card every signed-out auth page sits in. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="bg-muted/40 relative flex min-h-screen items-center justify-center p-6">
      <ThemeToggle className="absolute top-4 right-4" />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center">
          <Wordmark />
        </div>
        <Card>
          {SERVICE_PAUSED ? (
            <>
              <CardHeader>
                <CardTitle>Accounts are paused</CardTitle>
                <CardDescription>
                  Ops-Free is paused for now, so signing in and creating accounts are turned off.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <Link href="/" className="underline underline-offset-4">
                    See how Ops-Free works
                  </Link>
                </p>
                <p>
                  <Link href="/tools" className="underline underline-offset-4">
                    Use the free SES tools
                  </Link>
                </p>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">{children}</CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
