# Phase 5 — Template System

Status: **code complete**. 547 tests pass, and every template page
server-renders. Storage and rendering were verified on the live Supabase
database. **Not yet used in a browser**, and, like every send so far, no
templated email has reached real SES.

Source of truth: `docs/Ops-Free_Amazon_SES_Engine_SRS.pdf`: FR-6, §7, §8
step 3, §9, §12 (Templates screen).

---

## 1. Scope → where it lives

| Scope item | Where |
| --- | --- |
| HTML template editor | `/dashboard/templates/new`, `/dashboard/templates/[id]`: `TemplateEditor` |
| Plain-text fallback | optional text part; generated from the HTML when absent (`htmlToText`) |
| Variable definitions | name, required, default, sample, per template (`email_templates.variables`) |
| `{{variable}}` interpolation | `src/lib/templates/engine.ts` |
| Template versions | `email_template_versions` (immutable); view any version, restore as new |
| Template preview | live, in the editor, in a sandboxed iframe, rendered by the same engine as sending |
| Sample data | per-variable sample; used by preview, test send and the generated API example |
| Template validation | `validateTemplate` in the browser as you type, and again on the server at save |
| Test-send functionality | template page → sends the saved version through the real pipeline |

**Exit criterion:** create a reusable template (editor, saved as v1) → preview
it with sample data (live) → validate its variables (on save *and* on every
send) → send it through the API:

```json
POST /api/v1/send
{ "from": "…", "to": ["…"], "templateId": "<uuid>", "variables": { "first_name": "Ana" } }
```

---

## 2. Decisions worth defending

### 2.1 A deliberately tiny engine, not a template language

The engine does `{{ name }}` substitution and nothing else: no conditionals,
loops, helpers, partials or expressions. A template therefore cannot run code,
reach data it wasn't handed, or loop forever. Anything else starting `{{` is a
validation error with a line and column, never silently passed through. Adding
Handlebars or Liquid would bring a feature surface that then needs securing,
for features the SRS doesn't ask for.

It's pure and dependency-free, so the **browser preview runs the same code the
server sends with**. The preview can't disagree with what's delivered.

### 2.2 Output is encoded for where it lands

| Where the value goes | Encoding | Prevents |
| --- | --- | --- |
| HTML body | HTML-escaped `& < > " '` | markup/script injection through a variable |
| Subject | CR/LF collapsed to a space | header injection (`Bob\r\nBcc: …`) |
| Text body | as-is | — |

There is intentionally **no unescaped `{{{raw}}}`** form; it's rejected with an
explanation. A value containing `{{…}}` is not re-interpreted (tested).

### 2.3 Variables are strict both ways (SRS §9 "validate and constrain")

- **At save:** every variable used must be defined, or it's an error. A variable
  defined but never used is a warning.
- **At send:** a missing required variable (with no default) is refused, and so
  is **a variable the template doesn't define**. A typo like `frist_name`
  returns a 400 naming it, instead of sending "Hi ,". Values must be strings,
  numbers or booleans; objects, arrays and null are refused rather than
  rendered as `[object Object]`; each value is capped at 10,000 characters.
- A valid template that renders an **empty or over-length subject** with real
  values is refused at send time too, rather than failing inside SES.

### 2.4 Rendering happens at acceptance (SRS §8 step 3)

Resolve and render happen before the log is written or the job queued. A bad
send is a **400 with the reasons**, not a 202 that later fails in the worker.
The queued job carries rendered content, so the worker is unchanged.

### 2.5 Versions are immutable; restoring appends

Every save that changes content writes a new `email_template_versions` row and
bumps `version`, in one transaction. A save with no content change creates no
version, and neither does a rename (the name is for finding a template, not
part of what's sent). Restoring v1 creates v(n+1) with v1's content, so history
is never rewritten. **Each email log records `template_id` + `template_version`**,
and message detail links to the exact version that was sent, even after later
edits.

### 2.6 Two content modes on `POST /api/v1/send`

The SRS §7 example sends inline `subject`/`html`/`text` containing
`{{first_name}}`, together with `variables`. So:

| Request | Behaviour |
| --- | --- |
| `templateId` (+ `variables`) | render the stored template's current version |
| `templateId` + inline content | **400**, mutually exclusive ("which subject wins?" has no good silent answer) |
| inline + `variables` | interpolate the inline content with the same strict rules |
| inline, no `variables` | sent literally, **exactly as before Phase 5** |

The last row keeps existing callers unchanged: content that happens to contain
`{{` is not suddenly treated as a template.

### 2.7 Templates are per tenant, not per environment

Like code, one template serves staging and production; the SRS schema has no
environment column on `email_templates`. Archiving (`active = false`) stops a
template being sent while keeping its history. Archived and other tenants'
templates are refused with 400, and another tenant's id reads exactly like a
missing one.

---

## 3. The editor

- **Live validation** as you type: errors block saving; warnings (unused
  variables, `<script>`, no text part, required variable without a sample)
  don't.
- **Live preview:** the subject line, HTML in an `<iframe sandbox="">` (no
  scripts, no same-origin, no navigation), and plain text marked "generated"
  when it came from the HTML.
- A **"Define N used in the template"** button adds any `{{name}}` that isn't
  defined yet.
- Unsaved-changes indicator, a warning before leaving with unsaved work, and
  **⌘/Ctrl+S** to save.
- The template page adds: version history (view any version read-only, restore
  it), test send (editable JSON prefilled with the samples), and a copy-ready
  `curl` using this template's real id and sample variables.
- Activity gains a **template filter** (SRS §12, deferred in Phase 4 because
  templates didn't exist), and each row shows `name vN`.

---

## 4. Schema

Migration `drizzle/0003_phase5_templates.sql`. Additive; applied to Supabase.

| Change | Why |
| --- | --- |
| `email_template_versions` (unique `template_id, version`) | FR-6 "template versions"; the SRS baseline has only a `version` counter |
| `email_logs.template_version` (nullable) | pins exactly which version a message was rendered from |

---

## 5. Deliberate scope boundaries

| Not built | Why |
| --- | --- |
| Rich-text / WYSIWYG editing | this phase asks for an *HTML* editor; the SRS's "rich text" is a larger, separate feature |
| Conditionals, loops, formatting helpers | see §2.1: interpolation only, by design |
| Raw (unescaped) output | see §2.2 |
| Sending a specific older version via the API | sends always use the current version; restore to roll back |
| Per-environment templates | see §2.7 |
| Template-level analytics | not in scope; Activity's template filter gives per-template history |
| Test-send of unsaved edits | the test send uses the saved version and says so; preview covers unsaved edits |

---

## 6. Verification

**547 tests, 25 files** (Phase 4: 484). New or changed:

| File | Tests | Covers |
| --- | --- | --- |
| `unit/template-engine.test.ts` | 35 | grammar and error positions, validation rules, strict variables, **escaping by context incl. header injection**, plain-text generation, inline mode |
| `integration/templates.test.ts` | 24 | versions, restore, no-op saves, per-tenant names, isolation; **API sends with templates** (rendered content, version pinned on the log, 400s with reasons, archived, other tenant's id, suppression still applies); SRS §7 inline example; unchanged literal behaviour; dashboard save / test send / restore |
| `integration/pages-render.test.ts` | +4 | template list, new, editor, old-version view |
| `integration/send-route.test.ts` | 2 rewritten | Phase 1's "refuses templateId / variables" became "refuses templateId with inline content" / "refuses unused variables" |

**Mutation-checked.** Each of these, broken on purpose, fails the suite:

- no HTML escaping
- no CR/LF stripping in the subject
- accepting unknown variables
- `getTemplate` not tenant-scoped
- sending archived templates
- no version row on update

**Live on Supabase** through postgres-js: create, update to v2, restore to v3,
unique-name error, render-for-send with escaping, `template_version` on the log,
search, immutable history, cascade cleanup.

**Production build** ran in an isolated copy of the repo, because the dev
server was running. The project's `.next` was left untouched.

**Still to check by hand:**

- [ ] the editor in a browser: typing, preview updates, ⌘S, the "define used
      variables" button, restore
- [ ] a templated test send reaching SES (needs a verified sender, as before)
