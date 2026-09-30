"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { sendTestEmail, type TestSendState } from "@/app/dashboard/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Queueing…" : label}
    </Button>
  );
}

export function TestSendForm({
  defaultFrom,
}: {
  /** e.g. hello@<verified domain>, so the first send needs no typing. */
  defaultFrom?: string;
}) {
  const [state, action] = useActionState<TestSendState, FormData>(sendTestEmail, {});

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ts-from">From</Label>
          <Input
            id="ts-from"
            name="from"
            type="email"
            placeholder="you@your-verified-domain.com"
            defaultValue={defaultFrom}
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ts-to">To</Label>
          <Input
            id="ts-to"
            name="to"
            type="email"
            defaultValue="success@simulator.amazonses.com"
            autoComplete="off"
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ts-subject">Subject</Label>
        <Input id="ts-subject" name="subject" defaultValue="Test from Ops-Free SES" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ts-text">Message</Label>
        <textarea
          id="ts-text"
          name="text"
          rows={3}
          defaultValue="If you can read this, the pipeline works end to end."
          className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          required
        />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.sent ? (
        <Alert>
          <AlertDescription>
            Queued.{" "}
            <Link
              href={`/dashboard/activity/${state.sent.logId}`}
              className="font-medium underline underline-offset-4"
            >
              Follow this message →
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Send test email" />
        <p className="text-muted-foreground text-xs">
          The sender must be verified in SES. SES&apos;s mailbox simulator addresses
          (<code>success@</code>, <code>bounce@</code>, <code>complaint@simulator.amazonses.com</code>)
          are accepted even in the sandbox.
        </p>
      </div>
    </form>
  );
}
