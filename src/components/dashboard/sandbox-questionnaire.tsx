"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Circle } from "lucide-react";

import { saveSandboxDraft, type SaveDraftState } from "@/app/dashboard/sandbox/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACQUISITION_METHODS,
  adviceFor,
  EMAIL_TYPES,
  type Draft,
  type PlatformFacts,
} from "@/lib/sandbox/request";

/**
 * The interactive questionnaire — SRS §13. Every answer is the user's own; the
 * only things offered from the platform are facts the user may tick to
 * include, each labelled with where it comes from, and only when true.
 */
const STEPS = [
  "Account",
  "Use case",
  "Volume & quota",
  "Recipients",
  "Bounces & complaints",
  "Domain & evidence",
] as const;

const area =
  "border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

type Form = Omit<Draft, "dailyVolume" | "monthlyVolume" | "peakRate" | "requestedDailyQuota" | "requestedRate"> & {
  dailyVolume?: string;
  monthlyVolume?: string;
  peakRate?: string;
  requestedDailyQuota?: string;
  requestedRate?: string;
  contactsText?: string;
};

function toForm(d: Draft): Form {
  const s = (v: number | undefined) => (v === undefined ? "" : String(v));
  return {
    ...d,
    dailyVolume: s(d.dailyVolume),
    monthlyVolume: s(d.monthlyVolume),
    peakRate: s(d.peakRate),
    requestedDailyQuota: s(d.requestedDailyQuota),
    requestedRate: s(d.requestedRate),
    contactsText: (d.contacts ?? []).join(", "),
  };
}

/** Blank answers are dropped, never defaulted: omission, not invention. */
function toDraft(f: Form): Draft {
  const num = (v: string | undefined) => (v && v.trim() ? Number(v) : undefined);
  const str = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  const out: Draft = {
    region: str(f.region),
    mailType: f.mailType,
    companyName: str(f.companyName),
    websiteUrl: str(f.websiteUrl),
    useCase: str(f.useCase),
    emailTypes: f.emailTypes?.length ? f.emailTypes : undefined,
    otherEmailTypes: str(f.otherEmailTypes),
    dailyVolume: num(f.dailyVolume),
    monthlyVolume: num(f.monthlyVolume),
    peakRate: num(f.peakRate),
    frequency: str(f.frequency),
    acquisitionMethods: f.acquisitionMethods?.length ? f.acquisitionMethods : undefined,
    acquisitionDetails: str(f.acquisitionDetails),
    bounceHandling: str(f.bounceHandling),
    complaintHandling: str(f.complaintHandling),
    suppressionStrategy: str(f.suppressionStrategy),
    unsubscribeHandling: str(f.unsubscribeHandling),
    requestedDailyQuota: num(f.requestedDailyQuota),
    requestedRate: num(f.requestedRate),
    contacts: f.contactsText
      ?.split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean),
    language: f.language,
    include: f.include,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as Draft;
}

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function SandboxQuestionnaire({
  initial,
  facts,
  defaultRegion,
}: {
  initial: Draft;
  facts: PlatformFacts;
  defaultRegion: string | null;
}) {
  const [form, setForm] = useState<Form>(() => ({
    ...toForm(initial),
    region: initial.region ?? defaultRegion ?? "",
    include: initial.include ?? { domains: [], autoSuppression: false, metrics: false },
  }));
  const [step, setStep] = useState(0);
  const [state, action] = useActionState<SaveDraftState, FormData>(saveSandboxDraft, {});

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = <T extends string>(list: T[] | undefined, value: T) =>
    list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value];
  const include = form.include ?? { domains: [], autoSuppression: false, metrics: false };
  const draft = toDraft(form);
  const advice = adviceFor(draft, facts);

  return (
    <form
      action={action}
      onSubmit={() => {
        if (step < STEPS.length - 1) setStep((s) => s + 1);
      }}
      className="space-y-6"
    >
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />

      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                i === step ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
              }`}
            >
              {i < step ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      <div className="space-y-5">
        {step === 0 ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="AWS region" htmlFor="q-region" hint="Sending access is granted per region — the region of this environment's credential.">
                <Input id="q-region" value={form.region ?? ""} onChange={(e) => set("region", e.target.value)} placeholder="ap-south-1" />
              </Field>
              <Field label="Mail type" htmlFor="q-mail">
                <select
                  id="q-mail"
                  value={form.mailType ?? ""}
                  onChange={(e) => set("mailType", (e.target.value || undefined) as Form["mailType"])}
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">Choose…</option>
                  <option value="TRANSACTIONAL">Transactional — triggered by a user action</option>
                  <option value="MARKETING">Marketing — promotional or bulk</option>
                </select>
              </Field>
              <Field label="Company or product name" htmlFor="q-company">
                <Input id="q-company" value={form.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} />
              </Field>
              <Field label="Website URL" htmlFor="q-url" hint="AWS reviewers visit it.">
                <Input id="q-url" type="url" value={form.websiteUrl ?? ""} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://" />
              </Field>
              <Field label="Additional contact emails (optional)" htmlFor="q-contacts" hint="Up to 4; AWS notifies them about the case.">
                <Input id="q-contacts" value={form.contactsText ?? ""} onChange={(e) => set("contactsText", e.target.value)} />
              </Field>
              <Field label="Contact language" htmlFor="q-lang">
                <select
                  id="q-lang"
                  value={form.language ?? "EN"}
                  onChange={(e) => set("language", e.target.value as "EN" | "JA")}
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="EN">English</option>
                  <option value="JA">Japanese</option>
                </select>
              </Field>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Field
              label="Describe your product and why it sends email"
              htmlFor="q-usecase"
              hint={`${form.useCase?.length ?? 0} characters — at least 80. Say what triggers each email and who receives it. This is quoted verbatim.`}
            >
              <textarea id="q-usecase" rows={6} className={area} value={form.useCase ?? ""} onChange={(e) => set("useCase", e.target.value)} />
            </Field>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Kinds of email you will send</legend>
              {Object.entries(EMAIL_TYPES).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.emailTypes?.includes(key as keyof typeof EMAIL_TYPES) ?? false}
                    onChange={() => set("emailTypes", toggle(form.emailTypes, key as keyof typeof EMAIL_TYPES))}
                  />
                  {label}
                </label>
              ))}
              <Input aria-label="Other kinds of email" placeholder="Other (optional)" value={form.otherEmailTypes ?? ""} onChange={(e) => set("otherEmailTypes", e.target.value)} />
            </fieldset>
            <Field label="Sending pattern (optional)" htmlFor="q-freq" hint="e.g. “Sent immediately when a user signs up or resets a password.”">
              <Input id="q-freq" value={form.frequency ?? ""} onChange={(e) => set("frequency", e.target.value)} />
            </Field>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="text-muted-foreground text-sm">
              Your own estimates. They are stated to AWS as estimates, never as measurements, and
              nothing is filled in for you.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Emails per day" htmlFor="q-daily">
                <Input id="q-daily" type="number" min={1} value={form.dailyVolume ?? ""} onChange={(e) => set("dailyVolume", e.target.value)} />
              </Field>
              <Field label="Emails per month (optional)" htmlFor="q-monthly">
                <Input id="q-monthly" type="number" min={1} value={form.monthlyVolume ?? ""} onChange={(e) => set("monthlyVolume", e.target.value)} />
              </Field>
              <Field label="Peak per second (optional)" htmlFor="q-peak">
                <Input id="q-peak" type="number" min={1} value={form.peakRate ?? ""} onChange={(e) => set("peakRate", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Requested daily quota (optional)" htmlFor="q-quota" hint="Only if you need more than the default production quota.">
                <Input id="q-quota" type="number" min={1} value={form.requestedDailyQuota ?? ""} onChange={(e) => set("requestedDailyQuota", e.target.value)} />
              </Field>
              <Field label="Requested max send rate / second (optional)" htmlFor="q-rate">
                <Input id="q-rate" type="number" min={1} value={form.requestedRate ?? ""} onChange={(e) => set("requestedRate", e.target.value)} />
              </Field>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">How recipients get on your list</legend>
              {Object.entries(ACQUISITION_METHODS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.acquisitionMethods?.includes(key as keyof typeof ACQUISITION_METHODS) ?? false}
                    onChange={() => set("acquisitionMethods", toggle(form.acquisitionMethods, key as keyof typeof ACQUISITION_METHODS))}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <Field label="Describe the process" htmlFor="q-acq" hint="At least 40 characters. Quoted verbatim.">
              <textarea id="q-acq" rows={4} className={area} value={form.acquisitionDetails ?? ""} onChange={(e) => set("acquisitionDetails", e.target.value)} />
            </Field>
          </>
        ) : null}

        {step === 4 ? (
          <>
            {(
              [
                ["bounceHandling", "How you handle bounces"],
                ["complaintHandling", "How you handle complaints"],
                ["suppressionStrategy", "How you keep suppressed addresses from being mailed"],
                ["unsubscribeHandling", form.mailType === "MARKETING" ? "How recipients unsubscribe (required for marketing)" : "How recipients unsubscribe (optional for transactional)"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label} htmlFor={`q-${key}`} hint="Describe what you actually do. Quoted verbatim.">
                <textarea id={`q-${key}`} rows={3} className={area} value={(form[key] as string | undefined) ?? ""} onChange={(e) => set(key, e.target.value)} />
              </Field>
            ))}
            <label className={`flex items-start gap-2 rounded-md border p-3 text-sm ${facts.autoSuppressionActive ? "" : "opacity-60"}`}>
              <input
                type="checkbox"
                disabled={!facts.autoSuppressionActive}
                checked={include.autoSuppression && facts.autoSuppressionActive}
                onChange={(e) => set("include", { ...include, autoSuppression: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                Include a platform fact: bounce and complaint notifications arrive through SNS and those addresses are
                suppressed automatically.
                <span className="text-muted-foreground block text-xs">
                  {facts.autoSuppressionActive
                    ? "True for your account: SNS is confirmed and SES events were received in the last 30 days."
                    : "Unavailable: SNS is not connected or no SES events have arrived in 30 days, so this is not currently true."}
                </span>
              </span>
            </label>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Verified domains to cite (from SES and our DNS checks)</legend>
              {facts.domains.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No domain is verified in SES for this environment, so none can be cited.
                </p>
              ) : (
                facts.domains.map((f) => (
                  <label key={f.id} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={include.domains.includes(f.id)}
                      onChange={() => set("include", { ...include, domains: toggle(include.domains, f.id) })}
                    />
                    <span>
                      <span className="font-mono">{f.domain}</span> — SES verified; DKIM {f.dkim}, SPF {f.spf}, DMARC {f.dmarc}
                      {f.dmarcPolicy ? ` (p=${f.dmarcPolicy})` : ""}
                      <span className="text-muted-foreground block text-xs">Checked {f.checkedAt?.slice(0, 10) ?? "—"}</span>
                    </span>
                  </label>
                ))
              )}
            </fieldset>
            <label className={`flex items-start gap-2 rounded-md border p-3 text-sm ${facts.metrics ? "" : "opacity-60"}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={!facts.metrics}
                checked={include.metrics && Boolean(facts.metrics)}
                onChange={(e) => set("include", { ...include, metrics: e.target.checked })}
              />
              <span>
                Include measured bounce and complaint rates (last 30 days)
                <span className="text-muted-foreground block text-xs">
                  {facts.metrics
                    ? `${facts.metrics.reachedSes.toLocaleString("en-US")} messages; bounce ${(facts.metrics.bounceRate * 100).toFixed(2)}%, complaint ${(facts.metrics.complaintRate * 100).toFixed(2)}%.`
                    : "Unavailable: without SNS delivery outcomes, rates would read 0% because nothing is measured — citing that would mislead."}
                </span>
              </span>
            </label>
          </>
        ) : null}
      </div>

      {advice.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {advice.map((a) => (
            <li key={a}>• {a}</li>
          ))}
        </ul>
      ) : null}

      {state.error ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        {step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        ) : null}
        <Save label={step < STEPS.length - 1 ? "Save & continue" : "Save & generate request"} />
        {state.savedAt ? (
          <span className="text-muted-foreground text-xs" aria-live="polite">
            Draft saved.
            {state.missing?.length ? ` Still needed: ${state.missing.join("; ")}.` : " All required answers present."}
          </span>
        ) : null}
      </div>
    </form>
  );
}
