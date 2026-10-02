"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

import { pollAwsConnect, startAwsConnect } from "@/app/dashboard/aws/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SES_REGIONS } from "@/lib/aws/regions";

type Phase =
  | { name: "idle" }
  | { name: "starting" }
  | { name: "waiting"; connectionId: string; url: string }
  | { name: "connected" }
  | { name: "failed"; message: string };

const POLL_MS = 3000;

/**
 * One-click AWS connect. Opens AWS's "Create stack" page pre-filled for the
 * customer, then waits here while the stack reports back, so there is nothing to
 * copy or paste. Polls a Server Action; the tenant comes from the session.
 */
export function ConnectAwsButton({ defaultRegion = "ap-south-1" }: { defaultRegion?: string }) {
  const router = useRouter();
  const [region, setRegion] = useState(defaultRegion);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const poll = useCallback(
    (connectionId: string, url: string) => {
      timer.current = setTimeout(async () => {
        try {
          const s = await pollAwsConnect(connectionId);
          if (s.state === "connected") {
            setPhase({ name: "connected" });
            router.refresh();
            return;
          }
          if (s.state === "failed") {
            setPhase({ name: "failed", message: s.message });
            return;
          }
        } catch {
          // A dropped request is not a failed connection; keep waiting.
        }
        setPhase((p) => (p.name === "waiting" ? { name: "waiting", connectionId, url } : p));
        poll(connectionId, url);
      }, POLL_MS);
    },
    [router],
  );

  async function start() {
    stop();
    // Opened synchronously, inside the click, so popup blockers allow it; the
    // address is filled in once the server has minted the link.
    const tab = window.open("about:blank", "_blank");
    setPhase({ name: "starting" });

    const result = await startAwsConnect(region);
    if (!result.ok) {
      tab?.close();
      setPhase({ name: "failed", message: result.error });
      return;
    }
    if (tab) tab.location.href = result.url;
    setPhase({ name: "waiting", connectionId: result.connectionId, url: result.url });
    poll(result.connectionId, result.url);
  }

  if (phase.name === "connected") {
    return (
      <Alert>
        <CheckCircle2 className="size-4" aria-hidden />
        <AlertDescription>Connected. Ops-Free can now send through your AWS account.</AlertDescription>
      </Alert>
    );
  }

  const busy = phase.name === "starting" || phase.name === "waiting";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="connect-region">Region you send from</Label>
          <select
            id="connect-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={busy}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            {SES_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — {r.id}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" onClick={start} disabled={busy}>
          {phase.name === "starting" ? "Opening AWS…" : "Connect AWS"}
        </Button>
      </div>

      {phase.name === "waiting" ? (
        <Alert>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <AlertDescription className="space-y-2">
            <p>
              Waiting for AWS. In the tab that opened, tick the acknowledgement at the bottom and click{" "}
              <strong>Create stack</strong>. This page updates by itself, usually within a minute.
            </p>
            <p>
              <a
                href={phase.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
              >
                Tab didn&apos;t open? Open AWS
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {phase.name === "failed" ? (
        <Alert variant="destructive">
          <AlertDescription>{phase.message}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-muted-foreground text-xs">
        This creates one IAM role in your account that only Ops-Free can use, with the permissions listed in{" "}
        <a href="/aws-connect.yaml" target="_blank" rel="noreferrer" className="underline underline-offset-4">
          the template
        </a>
        . No keys are shared or stored. Delete the stack in AWS to revoke access.
      </p>
    </div>
  );
}
