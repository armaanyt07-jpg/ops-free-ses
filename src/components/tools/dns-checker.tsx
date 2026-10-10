"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { CheckBadge } from "@/components/dashboard/check-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CheckStatus, DkimResult, DmarcResult, SpfResult } from "@/lib/dns/checks";
import { RECOMMENDED_DMARC, RECOMMENDED_SPF } from "@/lib/dns/checks";

type Result = {
  domain: string;
  dkimChecked: boolean;
  spf: SpfResult;
  dmarc: DmarcResult;
  dkim: DkimResult;
};

function Row({
  title,
  status,
  found,
  problems,
  fix,
}: {
  title: string;
  status: CheckStatus | "skipped";
  found: string[];
  problems: string[];
  fix?: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl border p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{title}</p>
        {status === "skipped" ? (
          <span className="text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 text-xs">not checked</span>
        ) : (
          <CheckBadge status={status} />
        )}
      </div>
      {found.length > 0 ? (
        <div className="mt-3 space-y-1">
          <p className="text-muted-foreground text-xs">Published</p>
          {found.map((f) => (
            <p key={f} className="bg-muted rounded px-2 py-1 font-mono text-xs [overflow-wrap:anywhere]">
              {f}
            </p>
          ))}
        </div>
      ) : null}
      {problems.length > 0 ? (
        <ul className="text-muted-foreground mt-3 list-disc space-y-1 pl-5 text-sm">
          {problems.map((p) => (
            <li key={p}>{p.replace(/`/g, "")}</li>
          ))}
        </ul>
      ) : null}
      {fix && status !== "pass" && status !== "skipped" ? (
        <div className="text-muted-foreground mt-3 border-t pt-3 text-sm">{fix}</div>
      ) : null}
    </div>
  );
}

const mono = "bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-xs [overflow-wrap:anywhere]";

export function DnsChecker() {
  const [domain, setDomain] = useState("");
  const [dkim, setDkim] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/dns-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, dkim }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setResult(null);
        setError(data?.error ?? "The check didn't complete. Try again in a moment.");
      } else {
        setResult(data as Result);
      }
    } catch {
      setError("Couldn't reach the checker. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  const allPass =
    result && result.spf.status === "pass" && result.dmarc.status === "pass" && (!result.dkimChecked || result.dkim.status === "pass");

  return (
    <div className="mt-10">
      <form onSubmit={onSubmit} className="bg-card space-y-4 rounded-2xl border p-5 sm:p-6">
        <div className="space-y-1.5">
          <Label htmlFor="dns-domain">Domain</Label>
          <Input
            id="dns-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dns-dkim">SES DKIM tokens (optional)</Label>
          <textarea
            id="dns-dkim"
            value={dkim}
            onChange={(e) => setDkim(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={"Paste the three CNAME names from the SES console, e.g.\nabcdef1234567890abcdef1234567890._domainkey.example.com"}
            className="border-input bg-background focus-visible:ring-ring/50 w-full rounded-lg border px-2.5 py-2 font-mono text-xs focus-visible:ring-3 focus-visible:outline-none"
          />
          <p className="text-muted-foreground text-xs">
            In the SES console: Identities → your domain → Authentication. DKIM records are unique to your SES
            identity, so we can only check them if you paste them.
          </p>
        </div>
        <Button type="submit" disabled={pending || !domain.trim()}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? "Checking…" : "Check DNS"}
        </Button>
      </form>

      <div aria-live="polite">
        {error ? (
          <p role="alert" className="border-destructive/30 bg-destructive/5 text-destructive mt-6 rounded-xl border px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="mt-8 space-y-4">
            <p className="text-sm">
              Results for <span className="font-mono font-medium">{result.domain}</span>
              {allPass ? " — everything checked looks right." : ""}
            </p>
            <Row
              title="DKIM"
              status={result.dkimChecked ? result.dkim.status : "skipped"}
              found={result.dkim.records.flatMap((r) => r.found)}
              problems={result.dkimChecked ? result.dkim.problems : ["Paste your SES DKIM tokens above to check them."]}
              fix={
                <p>
                  Add each record as a <b>CNAME</b>. Its name is <span className={mono}>&lt;token&gt;._domainkey</span>{" "}
                  (most DNS providers add your domain themselves) and its value is{" "}
                  <span className={mono}>&lt;token&gt;.dkim.amazonses.com</span>.
                </p>
              }
            />
            <Row
              title="SPF"
              status={result.spf.status}
              found={result.spf.found}
              problems={result.spf.problems}
              fix={
                <p>
                  Keep exactly one SPF record and make sure it includes Amazon SES, for example{" "}
                  <span className={mono}>{RECOMMENDED_SPF}</span>. If you already have one, add{" "}
                  <span className={mono}>include:amazonses.com</span> to it instead of adding a second.
                </p>
              }
            />
            <Row
              title="DMARC"
              status={result.dmarc.status}
              found={result.dmarc.found}
              problems={result.dmarc.problems}
              fix={
                <p>
                  Add a TXT record named <span className={mono}>_dmarc</span> with the value{" "}
                  <span className={mono}>{RECOMMENDED_DMARC}</span>. Start with <span className={mono}>p=none</span>,
                  then tighten it once DKIM passes.
                </p>
              }
            />
            <p className="text-muted-foreground text-xs">
              DNS changes can take a few minutes to an hour to show up. Results come from public DNS and nothing
              is stored.{" "}
              <Link href="/signup" className="text-foreground underline underline-offset-4">
                Ops-Free
              </Link>{" "}
              re-checks these for you and, on Route 53, adds the DKIM records itself.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
