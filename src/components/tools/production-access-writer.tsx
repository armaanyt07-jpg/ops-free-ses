"use client";

import { useMemo, useState } from "react";

import { CopyButton } from "@/components/dashboard/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACQUISITION_METHODS,
  adviceFor,
  EMAIL_TYPES,
  generateRequest,
  missingAnswers,
  USE_CASE_MAX,
  type Draft,
  type PlatformFacts,
} from "@/lib/sandbox/request";

/**
 * The public version of the dashboard's request assistant. Same generator, so
 * the same promise holds: the text is built only from what the visitor types.
 * There are no platform facts here, because there is no account to read them from.
 */
const NO_FACTS: PlatformFacts = { domains: [], autoSuppressionActive: false, metrics: null };

const area =
  "border-input bg-background focus-visible:ring-ring/50 w-full rounded-lg border px-2.5 py-2 text-sm focus-visible:ring-3 focus-visible:outline-none";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

type Form = {
  region: string;
  mailType: "" | "TRANSACTIONAL" | "MARKETING";
  companyName: string;
  websiteUrl: string;
  useCase: string;
  emailTypes: Array<keyof typeof EMAIL_TYPES>;
  dailyVolume: string;
  peakRate: string;
  acquisitionMethods: Array<keyof typeof ACQUISITION_METHODS>;
  acquisitionDetails: string;
  bounceHandling: string;
  complaintHandling: string;
  suppressionStrategy: string;
  unsubscribeHandling: string;
};

const EMPTY: Form = {
  region: "us-east-1",
  mailType: "",
  companyName: "",
  websiteUrl: "",
  useCase: "",
  emailTypes: [],
  dailyVolume: "",
  peakRate: "",
  acquisitionMethods: [],
  acquisitionDetails: "",
  bounceHandling: "",
  complaintHandling: "",
  suppressionStrategy: "",
  unsubscribeHandling: "",
};

/** Blank answers are dropped, never defaulted: omission, not invention. */
function toDraft(f: Form): Draft {
  const str = (v: string) => (v.trim() ? v.trim() : undefined);
  const num = (v: string) => (v.trim() && Number(v) > 0 ? Math.floor(Number(v)) : undefined);
  const out: Draft = {
    region: str(f.region),
    mailType: f.mailType || undefined,
    companyName: str(f.companyName),
    websiteUrl: str(f.websiteUrl),
    useCase: str(f.useCase),
    emailTypes: f.emailTypes.length ? f.emailTypes : undefined,
    dailyVolume: num(f.dailyVolume),
    peakRate: num(f.peakRate),
    acquisitionMethods: f.acquisitionMethods.length ? f.acquisitionMethods : undefined,
    acquisitionDetails: str(f.acquisitionDetails),
    bounceHandling: str(f.bounceHandling),
    complaintHandling: str(f.complaintHandling),
    suppressionStrategy: str(f.suppressionStrategy),
    unsubscribeHandling: str(f.unsubscribeHandling),
    language: "EN",
    include: { domains: [], autoSuppression: false, metrics: false },
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Draft;
}

export function ProductionAccessWriter() {
  const [form, setForm] = useState<Form>(EMPTY);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = <T extends string>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const draft = useMemo(() => toDraft(form), [form]);
  const missing = missingAnswers(draft);
  const advice = adviceFor(draft, NO_FACTS).filter((a) => !a.startsWith("No sending domain") && !a.startsWith("SNS is not connected"));
  const generated = missing.length === 0 ? generateRequest(draft, NO_FACTS) : null;
  const text = generated?.fields.useCaseDescription ?? "";

  return (
    <div className="mt-10 space-y-8">
      <div className="bg-card space-y-5 rounded-2xl border p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pa-mail" label="Mail type">
            <select
              id="pa-mail"
              value={form.mailType}
              onChange={(e) => set("mailType", e.target.value as Form["mailType"])}
              className="border-input bg-background h-9 w-full rounded-lg border px-2.5 text-sm"
            >
              <option value="">Choose…</option>
              <option value="TRANSACTIONAL">Transactional: triggered by a user action</option>
              <option value="MARKETING">Marketing: promotional or bulk</option>
            </select>
          </Field>
          <Field id="pa-region" label="AWS region" hint="Access is granted per region.">
            <Input id="pa-region" value={form.region} onChange={(e) => set("region", e.target.value)} />
          </Field>
          <Field id="pa-company" label="Company or product name">
            <Input id="pa-company" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </Field>
          <Field id="pa-url" label="Website URL" hint="AWS reviewers visit it.">
            <Input id="pa-url" type="url" placeholder="https://" value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} />
          </Field>
        </div>

        <Field id="pa-usecase" label="What do you send, and why?" hint="Say what triggers each email and who receives it. At least 80 characters.">
          <textarea id="pa-usecase" rows={4} value={form.useCase} onChange={(e) => set("useCase", e.target.value)} className={area} />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Kinds of email</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(EMAIL_TYPES) as Array<keyof typeof EMAIL_TYPES>).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.emailTypes.includes(k)} onChange={() => set("emailTypes", toggle(form.emailTypes, k))} />
                {EMAIL_TYPES[k]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pa-daily" label="Emails per day you expect" hint="Your honest estimate.">
            <Input id="pa-daily" inputMode="numeric" value={form.dailyVolume} onChange={(e) => set("dailyVolume", e.target.value)} />
          </Field>
          <Field id="pa-peak" label="Peak emails per second (optional)">
            <Input id="pa-peak" inputMode="numeric" value={form.peakRate} onChange={(e) => set("peakRate", e.target.value)} />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">How you get recipients&apos; addresses</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(ACQUISITION_METHODS) as Array<keyof typeof ACQUISITION_METHODS>).map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.acquisitionMethods.includes(k)} onChange={() => set("acquisitionMethods", toggle(form.acquisitionMethods, k))} />
                {ACQUISITION_METHODS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="pa-acq" label="Describe it" hint="At least 40 characters.">
          <textarea id="pa-acq" rows={3} value={form.acquisitionDetails} onChange={(e) => set("acquisitionDetails", e.target.value)} className={area} />
        </Field>

        <Field id="pa-bounce" label="What happens when an email bounces?" hint="Describe what you actually do or will build.">
          <textarea id="pa-bounce" rows={2} value={form.bounceHandling} onChange={(e) => set("bounceHandling", e.target.value)} className={area} />
        </Field>
        <Field id="pa-complaint" label="What happens when someone marks an email as spam?">
          <textarea id="pa-complaint" rows={2} value={form.complaintHandling} onChange={(e) => set("complaintHandling", e.target.value)} className={area} />
        </Field>
        <Field id="pa-suppress" label="How do you stop sending to bad addresses?">
          <textarea id="pa-suppress" rows={2} value={form.suppressionStrategy} onChange={(e) => set("suppressionStrategy", e.target.value)} className={area} />
        </Field>
        {form.mailType === "MARKETING" ? (
          <Field id="pa-unsub" label="How do people unsubscribe?">
            <textarea id="pa-unsub" rows={2} value={form.unsubscribeHandling} onChange={(e) => set("unsubscribeHandling", e.target.value)} className={area} />
          </Field>
        ) : null}
      </div>

      {advice.length > 0 ? (
        <ul className="bg-muted/40 text-muted-foreground list-disc space-y-1.5 rounded-xl border py-4 pr-5 pl-9 text-sm">
          {advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}

      <div aria-live="polite">
        {generated ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Your request</p>
              <CopyButton text={text} label="Copy" />
            </div>
            <pre className="bg-muted/50 overflow-x-auto rounded-xl border p-4 text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
            <p className="text-muted-foreground text-xs">
              {text.length.toLocaleString("en-US")} of {USE_CASE_MAX.toLocaleString("en-US")} characters. Paste it into
              the SES console under Account dashboard → Request production access. Website URL:{" "}
              <span className="font-mono">{generated.fields.websiteUrl}</span>. Mail type:{" "}
              <span className="font-mono">{generated.fields.mailType}</span>.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Still needed: {missing.join(", ")}.
          </p>
        )}
      </div>
    </div>
  );
}
