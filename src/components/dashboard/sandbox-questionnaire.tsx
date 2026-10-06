"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

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
 * The questionnaire — SRS §13, on one screen. Three questions only the user
 * can answer (what they send, how recipients get on the list, daily volume);
 * everything the platform already knows is pre-filled or offered as evidence,
 * ticked when it is true and labelled with its source. The rest sits under
 * "More details", optional. Every answer stays the user's own and editable.
 */
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

/**
 * First visit: start from what the platform knows. Each is shown and can be
 * changed; a saved draft always wins, including evidence the user unticked.
 */
function initialForm(initial: Draft, facts: PlatformFacts, defaultRegion: string | null): Form {
  const firstDomain = facts.domains.find((d) => d.sesVerified)?.domain;
  return {
    ...toForm(initial),
    region: initial.region ?? defaultRegion ?? "",
    websiteUrl: initial.websiteUrl ?? (firstDomain ? `https://${firstDomain}` : ""),
    include: initial.include ?? {
      domains: facts.domains.filter((d) => d.sesVerified).map((d) => d.id),
      autoSuppression: facts.autoSuppressionActive,
      metrics: Boolean(facts.metrics),
    },
  };
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save & generate request"}
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

function Question({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="bg-primary/10 text-primary flex size-6 items-center justify-center rounded-full text-xs">{n}</span>
        {title}
      </h3>
      <div className="space-y-4 sm:pl-8">{children}</div>
    </section>
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
  const [form, setForm] = useState<Form>(() => initialForm(initial, facts, defaultRegion));
  const [state, action] = useActionState<SaveDraftState, FormData>(saveSandboxDraft, {});

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = <T extends string>(list: T[] | undefined, value: T) =>
    list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value];
  const include = form.include ?? { domains: [], autoSuppression: false, metrics: false };
  const draft = toDraft(form);
  const advice = adviceFor(draft, facts);
  // With automatic suppression cited, the platform describes bounce handling;
  // without it, the user's own process is required and asked for up front.
  const platformHandles = include.autoSuppression && facts.autoSuppressionActive;
  const verified = facts.domains.filter((d) => d.sesVerified);

  const handlingFields = [
    ["bounceHandling", "How you handle bounces"],
    ["complaintHandling", "How you handle complaints"],
    ["suppressionStrategy", "How you keep suppressed addresses from being mailed"],
  ] as const;
  const handlingInputs = handlingFields.map(([key, label]) => (
    <Field key={key} label={label} htmlFor={`q-${key}`} hint="Describe what you actually do. Quoted verbatim.">
      <textarea id={`q-${key}`} rows={2} className={area} value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
    </Field>
  ));
  const unsubscribeInput = (
    <Field
      label={form.mailType === "MARKETING" ? "How recipients unsubscribe" : "How recipients unsubscribe (optional)"}
      htmlFor="q-unsubscribeHandling"
      hint={form.mailType === "MARKETING" ? "Required for marketing mail. Quoted verbatim." : "Quoted verbatim."}
    >
      <textarea id="q-unsubscribeHandling" rows={2} className={area} value={form.unsubscribeHandling ?? ""} onChange={(e) => set("unsubscribeHandling", e.target.value)} />
    </Field>
  );

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />

      <Question n={1} title="What do you send?">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Mail type</legend>
          {(
            [
              ["TRANSACTIONAL", "Transactional", "Triggered by something the user did: sign-ups, resets, receipts."],
              ["MARKETING", "Marketing", "Promotional or bulk: newsletters, announcements."],
            ] as const
          ).map(([value, title, desc]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${form.mailType === value ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
            >
              <input type="radio" name="q-mail" className="mt-0.5" checked={form.mailType === value} onChange={() => set("mailType", value)} />
              <span>
                <span className="font-medium">{title}</span>
                <span className="text-muted-foreground block text-xs">{desc}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field
          label="Describe your product and why it sends email"
          htmlFor="q-usecase"
          hint={`${form.useCase?.length ?? 0} characters, at least 80. Say what triggers each email and who receives it. Quoted verbatim.`}
        >
          <textarea id="q-usecase" rows={4} className={area} value={form.useCase ?? ""} onChange={(e) => set("useCase", e.target.value)} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Kinds of email</legend>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
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
          </div>
          <Input aria-label="Other kinds of email" placeholder="Other (optional)" value={form.otherEmailTypes ?? ""} onChange={(e) => set("otherEmailTypes", e.target.value)} />
        </fieldset>
      </Question>

      <Question n={2} title="How do people get on your list?">
        <fieldset className="space-y-2">
          <legend className="sr-only">Ways recipients get on your list</legend>
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
        <Field label="Describe the process" htmlFor="q-acq" hint={`${form.acquisitionDetails?.length ?? 0} characters, at least 40. Quoted verbatim.`}>
          <textarea id="q-acq" rows={3} className={area} value={form.acquisitionDetails ?? ""} onChange={(e) => set("acquisitionDetails", e.target.value)} />
        </Field>
      </Question>

      <Question n={3} title="How much will you send?">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Emails per day" htmlFor="q-daily" hint="Your own estimate. It's stated to AWS as one.">
            <Input id="q-daily" type="number" min={1} value={form.dailyVolume ?? ""} onChange={(e) => set("dailyVolume", e.target.value)} />
          </Field>
          <Field label="Website" htmlFor="q-url" hint="AWS reviewers visit it.">
            <Input id="q-url" type="url" value={form.websiteUrl ?? ""} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://" />
          </Field>
        </div>
      </Question>

      {!platformHandles || form.mailType === "MARKETING" ? (
        <Question n={4} title={platformHandles ? "How do people unsubscribe?" : "How do you handle bounces and complaints?"}>
          {!platformHandles ? (
            <p className="text-muted-foreground text-sm">
              {facts.autoSuppressionActive
                ? "You unticked automatic suppression below, so describe your own process."
                : "Delivery events aren't connected, so this account can't show automatic handling yet. Describe the process you have."}
            </p>
          ) : null}
          {!platformHandles ? handlingInputs : null}
          {form.mailType === "MARKETING" ? unsubscribeInput : null}
        </Question>
      ) : null}

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Evidence from your account</h3>
          <p className="text-muted-foreground text-xs">Included when true right now. Untick anything you&apos;d rather leave out.</p>
        </div>
        {verified.length === 0 ? (
          <p className="text-muted-foreground rounded-md border p-3 text-sm">No domain is verified in SES for this environment, so none can be cited.</p>
        ) : (
          verified.map((f) => (
            <label key={f.id} className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={include.domains.includes(f.id)}
                onChange={() => set("include", { ...include, domains: toggle(include.domains, f.id) })}
              />
              <span>
                <span className="font-mono">{f.domain}</span>: SES verified; DKIM {f.dkim}, SPF {f.spf}, DMARC {f.dmarc}
                {f.dmarcPolicy ? ` (p=${f.dmarcPolicy})` : ""}
                <span className="text-muted-foreground block text-xs">Checked {f.checkedAt?.slice(0, 10) ?? "—"}</span>
              </span>
            </label>
          ))
        )}
        <label className={`flex items-start gap-2 rounded-md border p-3 text-sm ${facts.autoSuppressionActive ? "" : "opacity-60"}`}>
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={!facts.autoSuppressionActive}
            checked={platformHandles}
            onChange={(e) => set("include", { ...include, autoSuppression: e.target.checked })}
          />
          <span>
            Bounces and complaints arrive through SNS and those addresses are suppressed automatically
            <span className="text-muted-foreground block text-xs">
              {facts.autoSuppressionActive
                ? "True for your account: SNS is confirmed and SES events arrived in the last 30 days. This answers AWS's bounce and complaint questions for you."
                : "Unavailable: SNS is not connected or no SES events have arrived in 30 days, so this is not currently true."}
            </span>
          </span>
        </label>
        <label className={`flex items-start gap-2 rounded-md border p-3 text-sm ${facts.metrics ? "" : "opacity-60"}`}>
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={!facts.metrics}
            checked={include.metrics && Boolean(facts.metrics)}
            onChange={(e) => set("include", { ...include, metrics: e.target.checked })}
          />
          <span>
            Measured bounce and complaint rates (last 30 days)
            <span className="text-muted-foreground block text-xs">
              {facts.metrics
                ? `${facts.metrics.reachedSes.toLocaleString("en-US")} messages; bounce ${(facts.metrics.bounceRate * 100).toFixed(2)}%, complaint ${(facts.metrics.complaintRate * 100).toFixed(2)}%.`
                : "Unavailable: without SNS delivery outcomes, rates would read 0% because nothing is measured. Citing that would mislead."}
            </span>
          </span>
        </label>
      </section>

      <details className="group rounded-lg border px-4 py-3" open={!form.region}>
        <summary className="cursor-pointer text-sm font-medium">More details (optional)</summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company or product name" htmlFor="q-company">
              <Input id="q-company" value={form.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} />
            </Field>
            <Field label="AWS region" htmlFor="q-region" hint="Filled in from your AWS connection. Access is granted per region.">
              <Input id="q-region" value={form.region ?? ""} onChange={(e) => set("region", e.target.value)} placeholder="ap-south-1" />
            </Field>
            <Field label="Additional contact emails" htmlFor="q-contacts" hint="Up to 4; AWS notifies them about the case.">
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
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Emails per month" htmlFor="q-monthly">
              <Input id="q-monthly" type="number" min={1} value={form.monthlyVolume ?? ""} onChange={(e) => set("monthlyVolume", e.target.value)} />
            </Field>
            <Field label="Peak per second" htmlFor="q-peak">
              <Input id="q-peak" type="number" min={1} value={form.peakRate ?? ""} onChange={(e) => set("peakRate", e.target.value)} />
            </Field>
            <Field label="Sending pattern" htmlFor="q-freq">
              <Input id="q-freq" value={form.frequency ?? ""} onChange={(e) => set("frequency", e.target.value)} placeholder="Sent when a user signs up" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Requested daily quota" htmlFor="q-quota" hint="Only if you need more than the default production quota.">
              <Input id="q-quota" type="number" min={1} value={form.requestedDailyQuota ?? ""} onChange={(e) => set("requestedDailyQuota", e.target.value)} />
            </Field>
            <Field label="Requested max send rate / second" htmlFor="q-rate">
              <Input id="q-rate" type="number" min={1} value={form.requestedRate ?? ""} onChange={(e) => set("requestedRate", e.target.value)} />
            </Field>
          </div>
          {platformHandles ? (
            <>
              <p className="text-muted-foreground text-xs">
                Automatic suppression already answers these. Add your own words only if you do more.
              </p>
              {handlingInputs}
            </>
          ) : null}
          {form.mailType !== "MARKETING" ? unsubscribeInput : null}
        </div>
      </details>

      {advice.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {advice.map((a) => (
            <li key={a}>• {a}</li>
          ))}
        </ul>
      ) : null}

      {state.error ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Save />
        {state.savedAt ? (
          <span className="text-muted-foreground text-xs" aria-live="polite">
            Saved.
            {state.missing?.length ? (
              ` Still needed: ${state.missing.join("; ")}.`
            ) : (
              <>
                {" "}
                <a href="#request" className="underline underline-offset-4">
                  Review the request below
                </a>
                .
              </>
            )}
          </span>
        ) : null}
      </div>
    </form>
  );
}
