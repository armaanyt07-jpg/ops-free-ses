"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { sendTemplateTest, type TemplateTestState } from "@/app/dashboard/templates/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Queueing…" : "Send test"}
    </Button>
  );
}

/**
 * FR-6 test-send workflow. Renders the saved current version with these
 * values and sends it through the real pipeline. The variables box is the
 * same JSON an API caller would put in `variables`, prefilled with samples.
 */
export function TemplateTestForm({
  templateId,
  version,
  samples,
  archived,
}: {
  templateId: string;
  version: number;
  samples: Record<string, string>;
  archived: boolean;
}) {
  const [state, action] = useActionState<TemplateTestState, FormData>(sendTemplateTest, {});

  if (archived) {
    return <p className="text-muted-foreground text-sm">Archived templates cannot be sent. Restore it first.</p>;
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={templateId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tt-from">From</Label>
          <Input id="tt-from" name="from" type="email" placeholder="you@your-verified-domain.com" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tt-to">To</Label>
          <Input id="tt-to" name="to" type="email" defaultValue="success@simulator.amazonses.com" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tt-vars">Variables (JSON)</Label>
        <textarea
          id="tt-vars"
          name="variables"
          rows={Math.min(10, Object.keys(samples).length + 2)}
          defaultValue={JSON.stringify(samples, null, 2)}
          spellCheck={false}
          className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
        />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error}
            {state.details?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {state.details.map((d) => (
                  <li key={d}>{d.replaceAll("`", "")}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {state.sent ? (
        <Alert>
          <AlertDescription>
            v{state.sent.version} queued.{" "}
            <Link href={`/dashboard/activity/${state.sent.logId}`} className="font-medium underline underline-offset-4">
              Follow this message →
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Submit />
        <p className="text-muted-foreground text-xs">Sends the saved v{version}, not unsaved edits.</p>
      </div>
    </form>
  );
}
