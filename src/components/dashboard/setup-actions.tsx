"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  connectEventsAction,
  createQuickKey,
  type ConnectEventsState,
  type QuickKeyState,
} from "@/app/dashboard/actions";
import { CopyButton } from "@/components/dashboard/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function Submit({
  idle,
  busy,
  variant,
}: {
  idle: string;
  busy: string;
  variant?: "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

function curlSnippet(appUrl: string, key: string, from: string): string {
  return [
    `curl -X POST ${appUrl}/api/v1/send \\`,
    `  -H "Authorization: Bearer ${key}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"from":"${from}","to":["success@simulator.amazonses.com"],"subject":"Hello","text":"It works."}'`,
  ].join("\n");
}

/**
 * Setup step "API key". Stays mounted when the key appears server-side, so
 * the secret — held only in this component's state — survives the refresh
 * that marks the step done.
 */
export function QuickKeyStep({
  done,
  appUrl,
  from,
}: {
  done: boolean;
  appUrl: string;
  from: string;
}) {
  const [state, action] = useActionState<QuickKeyState>(createQuickKey, {});

  if (state.secret) {
    const snippet = curlSnippet(appUrl, state.secret, from);
    return (
      <div className="space-y-3">
        <Alert>
          <AlertTitle>Copy this key now</AlertTitle>
          <AlertDescription>
            It is shown only once. Store it as a secret in your app (for example{" "}
            <code>OPS_FREE_API_KEY</code>).
          </AlertDescription>
        </Alert>
        <div className="flex items-center gap-2">
          <code className="bg-muted min-w-0 flex-1 rounded-md px-3 py-2 font-mono text-xs break-all">
            {state.secret}
          </code>
          <CopyButton text={state.secret} label="Copy key" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">Send from your code:</p>
            <CopyButton text={snippet} label="Copy" />
          </div>
          <pre className="overflow-x-auto rounded-lg bg-zinc-950 dark:ring-1 dark:ring-white/10 p-3 font-mono text-xs leading-relaxed text-zinc-200">
            {snippet}
          </pre>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <p className="text-muted-foreground text-sm">
        You have an API key.{" "}
        <Link href="/dashboard/api-keys" className="text-foreground underline underline-offset-4">
          Manage keys
        </Link>
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Your app uses this key to call the send API.
      </p>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Submit idle="Create API key" busy="Creating…" />
    </form>
  );
}

/** One click for the SNS + SES wiring that used to be four manual steps. */
export function ConnectEventsButton({
  local,
  connected = false,
}: {
  local: boolean;
  /** Already confirmed: the same action, offered as a quiet "re-apply". */
  connected?: boolean;
}) {
  const [state, action] = useActionState<ConnectEventsState>(connectEventsAction, {});

  return (
    <form action={action} className="space-y-3">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.success ? (
        <Alert>
          <AlertDescription>{state.success}</AlertDescription>
        </Alert>
      ) : null}
      {local ? (
        <p className="text-muted-foreground text-xs">
          Available once the app is deployed: AWS can&apos;t deliver events to a local address.
        </p>
      ) : null}
      {state.success ? null : local ? (
        <Button type="button" disabled>
          Connect events
        </Button>
      ) : (
        <Submit
          idle={connected ? "Apply to new domains" : "Connect events"}
          busy="Setting up in AWS…"
          variant={connected ? "outline" : undefined}
        />
      )}
    </form>
  );
}
