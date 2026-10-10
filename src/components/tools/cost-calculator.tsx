"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatUsd,
  opsFreeCost,
  PRICES_CHECKED,
  resendCost,
  SAMPLE_VOLUMES,
} from "@/lib/pricing/compare";

const MAX = 50_000_000;

export function CostCalculator() {
  const [raw, setRaw] = useState("50000");
  const parsed = Number(raw.replace(/[,\s]/g, ""));
  const emails = Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 0), MAX) : 0;

  const ops = opsFreeCost(emails);
  const resend = resendCost(emails);
  const saving = resend ? resend.total - ops.total : null;

  return (
    <div className="mt-10 space-y-6">
      <div className="bg-card rounded-2xl border p-5 sm:p-6">
        <Label htmlFor="calc-emails">Emails per month</Label>
        <Input
          id="calc-emails"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="mt-1.5 h-10 max-w-xs tabular-nums"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLE_VOLUMES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setRaw(String(v))}
              className={`rounded-full border px-3 py-1 text-xs tabular-nums transition-colors ${
                emails === v ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
              }`}
            >
              {v.toLocaleString("en-US")}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="border-primary rounded-2xl border p-5 ring-4 ring-primary/10">
          <p className="text-sm font-semibold">Amazon SES + Ops-Free</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">
            {formatUsd(ops.total)}
            <span className="text-muted-foreground text-sm font-normal"> / month</span>
          </p>
          <dl className="text-muted-foreground mt-4 space-y-1 text-sm tabular-nums">
            <div className="flex justify-between">
              <dt>Ops-Free</dt>
              <dd>{formatUsd(ops.opsFree)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Amazon SES (billed by AWS)</dt>
              <dd>{formatUsd(ops.ses)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border p-5">
          <p className="text-sm font-semibold">Resend{resend ? ` (${resend.tier})` : ""}</p>
          {resend ? (
            <>
              <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">
                {formatUsd(resend.total)}
                <span className="text-muted-foreground text-sm font-normal"> / month</span>
              </p>
              <p className="text-muted-foreground mt-4 text-sm">Sending included in the price.</p>
            </>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">
              Above Resend&apos;s published plans: quoted as custom pricing.
            </p>
          )}
        </div>
      </div>

      {saving !== null && saving > 0 ? (
        <p className="text-sm">
          At {emails.toLocaleString("en-US")} emails a month that is{" "}
          <span className="font-semibold">{formatUsd(saving)} less</span> a month with Amazon SES and Ops-Free.
        </p>
      ) : saving !== null && saving < 0 ? (
        <p className="text-sm">
          At this volume Resend is {formatUsd(-saving)} cheaper a month.
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs leading-relaxed">
        Prices checked {PRICES_CHECKED} against each company&apos;s public pricing page, in US dollars. Amazon SES is
        $0.10 per 1,000 emails and excludes attachment data and any extras you use. Resend figures use its
        cheapest published plan for your volume, including overage. Plans change, so check{" "}
        <a href="https://resend.com/pricing" className="underline underline-offset-4" target="_blank" rel="noreferrer">
          resend.com/pricing
        </a>{" "}
        and{" "}
        <a href="https://aws.amazon.com/ses/pricing/" className="underline underline-offset-4" target="_blank" rel="noreferrer">
          aws.amazon.com/ses/pricing
        </a>{" "}
        before you decide. Ops-Free itself is free.
      </p>
    </div>
  );
}
