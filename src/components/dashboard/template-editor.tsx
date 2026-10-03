"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CheckCircle2, OctagonAlert, Plus, Trash2 } from "lucide-react";

import { saveTemplate, type SaveTemplateState } from "@/app/dashboard/templates/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  hasErrors,
  referencedVariables,
  render,
  validateTemplate,
  type Issue,
  type VariableDefinition,
} from "@/lib/templates/engine";

/**
 * Template editor — FR-6: HTML editing, plain-text fallback, variable
 * definitions, instant preview with sample data, validation.
 *
 * Validation and preview run the *same* engine the server uses to send
 * (`src/lib/templates/engine.ts`), in the browser, on every keystroke — so the
 * preview cannot drift from what is delivered. The server validates again on
 * save; this is the convenience, that is the gate.
 */
export interface EditorContent {
  name: string;
  subject: string;
  html: string;
  text: string;
  variables: VariableDefinition[];
}

const field =
  "border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 font-mono text-xs leading-relaxed focus-visible:ring-2 focus-visible:outline-none";

function SaveButton({ disabled, isNew }: { disabled: boolean; isNew: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Saving…" : isNew ? "Create template" : "Save new version"}
    </Button>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div className="space-y-2 text-sm" aria-live="polite">
      <p className="flex items-center gap-2 font-medium">
        {errors.length > 0 ? (
          <>
            <OctagonAlert className="size-4 text-red-700 dark:text-red-400" aria-hidden />
            {errors.length} error{errors.length === 1 ? "" : "s"} — fix before saving
          </>
        ) : (
          <>
            <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
            Valid
            {warnings.length > 0 ? ` · ${warnings.length} suggestion${warnings.length === 1 ? "" : "s"}` : ""}
          </>
        )}
      </p>
      {issues.length > 0 ? (
        <ul className="space-y-1">
          {[...errors, ...warnings].map((issue, i) => (
            <li key={i} className="flex gap-2 text-xs">
              {issue.severity === "error" ? (
                <OctagonAlert className="mt-0.5 size-3.5 shrink-0 text-red-700 dark:text-red-400" aria-label="Error" />
              ) : (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-400" aria-label="Warning" />
              )}
              <span>
                <span className="text-muted-foreground">
                  {issue.part}
                  {issue.line ? ` ${issue.line}:${issue.column}` : ""} ·{" "}
                </span>
                {issue.message.replaceAll("`", "")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TemplateEditor({
  templateId,
  initial,
  currentVersion,
}: {
  templateId?: string | undefined;
  initial: EditorContent;
  currentVersion?: number | undefined;
}) {
  const [content, setContent] = useState<EditorContent>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [tab, setTab] = useState<"html" | "text">("html");
  const [state, action] = useActionState<SaveTemplateState, FormData>(saveTemplate, {});
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = JSON.stringify(content) !== baseline;

  // After a successful save, the saved content is the new baseline.
  useEffect(() => {
    if (state.saved) setBaseline(JSON.stringify(content));
    // Only on a new save result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.saved?.at]);

  // Warn before navigating away from unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ⌘/Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const source = useMemo(
    () => ({
      subject: content.subject,
      html: content.html,
      text: content.text,
      variables: content.variables,
    }),
    [content],
  );

  const issues = useMemo(() => validateTemplate(source), [source]);
  const blocked = hasErrors(issues);

  // Names used in the template that have no definition yet.
  const undefinedNames = useMemo(() => {
    const defined = new Set(content.variables.map((v) => v.name));
    return [
      ...new Set(
        [content.subject, content.html, content.text].flatMap(referencedVariables),
      ),
    ].filter((n) => !defined.has(n));
  }, [content]);

  // Preview with sample data; anything without a sample shows as [name], so a
  // gap is visible instead of silently blank.
  const preview = useMemo(() => {
    const values = Object.fromEntries(
      content.variables.map((v) => [v.name, v.sample || v.defaultValue || `[${v.name}]`]),
    );
    try {
      return render(source, values);
    } catch {
      return null;
    }
  }, [source, content.variables]);

  const set = <K extends keyof EditorContent>(key: K, value: EditorContent[K]) =>
    setContent((c) => ({ ...c, [key]: value }));

  const setVar = (i: number, patch: Partial<VariableDefinition>) =>
    set(
      "variables",
      content.variables.map((v, j) => (j === i ? { ...v, ...patch } : v)),
    );

  return (
    <form ref={formRef} action={action} className="space-y-6">
      {templateId ? <input type="hidden" name="id" value={templateId} /> : null}
      <input type="hidden" name="variables" value={JSON.stringify(content.variables)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="tpl-name">Template name</Label>
          <Input
            id="tpl-name"
            name="name"
            value={content.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="welcome-email"
            required
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs" aria-live="polite">
            {dirty
              ? "Unsaved changes"
              : state.saved
                ? state.saved.newVersion
                  ? `Saved as v${state.saved.version}`
                  : "No content changes — no new version"
                : currentVersion
                  ? `v${currentVersion}`
                  : ""}
          </span>
          <SaveButton disabled={blocked || (!dirty && Boolean(templateId))} isNew={!templateId} />
        </div>
      </div>

      {state.error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200 dark:text-red-300">
          {state.error}
          {state.issues?.length ? <IssueList issues={state.issues} /> : null}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Left: source */}
        <div className="min-w-0 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-subject">Subject</Label>
            <Input
              id="tpl-subject"
              name="subject"
              value={content.subject}
              onChange={(e) => set("subject", e.target.value)}
              placeholder="Welcome, {{first_name}}"
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-html">HTML</Label>
            <textarea
              id="tpl-html"
              name="html"
              value={content.html}
              onChange={(e) => set("html", e.target.value)}
              rows={16}
              spellCheck={false}
              className={field}
              placeholder="<h1>Hello {{first_name}}</h1>"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-text">
              Plain text <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <textarea
              id="tpl-text"
              name="text"
              value={content.text}
              onChange={(e) => set("text", e.target.value)}
              rows={6}
              spellCheck={false}
              className={field}
              placeholder="Leave empty and a plain-text version is generated from the HTML."
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Variables</legend>
            <p className="text-muted-foreground text-xs">
              Use them as <code>{"{{name}}"}</code>. Values are HTML-escaped in the HTML body. The
              sample is used for the preview and test sends; the default is used when a send
              leaves the variable out.
            </p>

            {undefinedNames.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  set("variables", [
                    ...content.variables,
                    ...undefinedNames.map((name) => ({ name, required: true, sample: "" })),
                  ])
                }
              >
                <Plus className="size-4" aria-hidden /> Define {undefinedNames.length} used in the
                template ({undefinedNames.join(", ")})
              </Button>
            ) : null}

            {content.variables.length > 0 ? (
              <div className="space-y-2">
                {content.variables.map((v, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <Input
                      aria-label="Variable name"
                      value={v.name}
                      onChange={(e) => setVar(i, { name: e.target.value.trim() })}
                      placeholder="name"
                      className="col-span-2 font-mono text-xs sm:col-span-1"
                    />
                    <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={v.required}
                        onChange={(e) => setVar(i, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <Input
                      aria-label={`Sample value for ${v.name}`}
                      value={v.sample ?? ""}
                      onChange={(e) => setVar(i, { sample: e.target.value })}
                      placeholder="sample"
                      className="text-xs"
                    />
                    <Input
                      aria-label={`Default value for ${v.name}`}
                      value={v.defaultValue ?? ""}
                      onChange={(e) =>
                        setVar(i, { defaultValue: e.target.value === "" ? undefined : e.target.value })
                      }
                      placeholder="default (optional)"
                      className="text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${v.name || "variable"}`}
                      onClick={() => set("variables", content.variables.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">No variables defined.</p>
            )}

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                set("variables", [...content.variables, { name: "", required: false, sample: "" }])
              }
            >
              <Plus className="size-4" aria-hidden /> Add variable
            </Button>
          </fieldset>
        </div>

        {/* Right: validation + preview */}
        <div className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-lg border p-4">
            <IssueList issues={issues} />
          </div>

          <div className="overflow-hidden rounded-lg border">
            <div className="bg-muted/40 space-y-1 border-b px-4 py-3">
              <p className="text-muted-foreground text-xs">Subject</p>
              <p className="text-sm font-medium break-words">{preview?.subject || "—"}</p>
            </div>
            <div className="flex border-b text-sm" role="tablist">
              {(["html", "text"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 ${tab === t ? "border-foreground border-b-2 font-medium" : "text-muted-foreground"}`}
                >
                  {t === "html" ? "HTML preview" : "Plain text"}
                  {t === "text" && preview?.textGenerated ? (
                    <span className="text-muted-foreground ml-1 text-xs">(generated)</span>
                  ) : null}
                </button>
              ))}
            </div>
            {tab === "html" ? (
              // sandbox="" : no scripts, no same-origin access, no navigation.
              <iframe
                title="HTML preview"
                sandbox=""
                srcDoc={preview?.html ?? ""}
                className="h-[28rem] w-full bg-white"
              />
            ) : (
              <pre className="h-[28rem] overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">
                {preview?.text ?? ""}
              </pre>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            Preview uses each variable&apos;s sample (or default). Missing ones show as{" "}
            <code>[name]</code>.
          </p>
        </div>
      </div>
    </form>
  );
}
