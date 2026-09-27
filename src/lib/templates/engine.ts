/**
 * The template engine — SRS FR-6 "{{variable}} interpolation", §9 "Validate
 * and constrain template variables".
 *
 * Deliberately tiny and strict. It does interpolation and nothing else: no
 * conditionals, no loops, no helpers, no partials, no expression evaluation —
 * so a template can never run code, read anything it was not handed, or loop
 * forever. That is the whole point of writing it rather than pulling in a
 * general-purpose template language whose feature surface would then need
 * securing.
 *
 * Pure and dependency-free: the server renders with it at send time, and the
 * dashboard's live preview runs the *same* code in the browser, so the preview
 * cannot disagree with what is sent.
 *
 * Grammar
 *   {{ name }}   a variable; whitespace inside the braces is allowed
 *   name         letter or underscore, then letters, digits, underscores;
 *                at most 64 characters
 *   anything else starting with `{{` is an error with a line and column
 *
 * Output encoding, by where the value lands
 *   HTML body    HTML-escaped (& < > " ') — a value can never inject markup
 *   subject      CR/LF collapsed to spaces — a value can never inject a header
 *   text body    as-is
 *
 * There is intentionally no unescaped `{{{raw}}}` form.
 */

export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const MAX_VARIABLES = 50;
export const MAX_VALUE_LENGTH = 10_000;
export const MAX_SUBJECT_LENGTH = 998;
export const MAX_HTML_BYTES = 512 * 1024;
export const MAX_TEXT_BYTES = 256 * 1024;

export type TemplatePart = "subject" | "html" | "text";

export interface VariableDefinition {
  name: string;
  required: boolean;
  /** Used when a value is not supplied. Makes `required` moot. */
  defaultValue?: string | undefined;
  /** Sample data for preview and test sends. */
  sample?: string | undefined;
  description?: string | undefined;
}

export interface TemplateSource {
  subject: string;
  html: string;
  /** Optional; generated from the HTML when absent. */
  text?: string | null | undefined;
  variables: VariableDefinition[];
}

export interface Issue {
  severity: "error" | "warning";
  part: TemplatePart | "variables";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Token = { kind: "text"; value: string } | { kind: "var"; name: string };

interface ParseResult {
  tokens: Token[];
  errors: Array<{ message: string; line: number; column: number }>;
}

function position(source: string, index: number) {
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  const column = index - before.lastIndexOf("\n");
  return { line, column };
}

export function parse(source: string): ParseResult {
  const tokens: Token[] = [];
  const errors: ParseResult["errors"] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf("{{", cursor);
    if (open === -1) {
      tokens.push({ kind: "text", value: source.slice(cursor) });
      break;
    }
    if (open > cursor) tokens.push({ kind: "text", value: source.slice(cursor, open) });

    const close = source.indexOf("}}", open + 2);
    const nextOpen = source.indexOf("{{", open + 2);
    if (close === -1 || (nextOpen !== -1 && nextOpen < close)) {
      errors.push({ message: "`{{` is never closed with `}}`.", ...position(source, open) });
      // Keep the rest as literal text so later tags still get checked.
      tokens.push({ kind: "text", value: "{{" });
      cursor = open + 2;
      continue;
    }

    const inner = source.slice(open + 2, close);
    const name = inner.trim();
    if (inner.startsWith("{") || source[close + 2] === "}") {
      errors.push({
        message: "`{{{ }}}` (unescaped output) is not supported. Use `{{ name }}` — values are escaped for you.",
        ...position(source, open),
      });
    } else if (!VARIABLE_NAME.test(name)) {
      errors.push({
        message: name
          ? `\`{{${inner}}}\` is not a valid variable. Names start with a letter or _, then letters, digits or _ — no dots, spaces, helpers or logic.`
          : "Empty `{{ }}` tag.",
        ...position(source, open),
      });
    } else {
      tokens.push({ kind: "var", name });
    }
    cursor = close + 2;
  }

  return { tokens, errors };
}

export function referencedVariables(source: string): string[] {
  return [
    ...new Set(
      parse(source).tokens.flatMap((t) => (t.kind === "var" ? [t.name] : [])),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Validation (of the template, when it is saved)
// ---------------------------------------------------------------------------

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export function validateTemplate(source: TemplateSource): Issue[] {
  const issues: Issue[] = [];
  const parts: Array<[TemplatePart, string]> = [
    ["subject", source.subject],
    ["html", source.html],
    ["text", source.text ?? ""],
  ];

  // Definitions themselves.
  const defined = new Map<string, VariableDefinition>();
  if (source.variables.length > MAX_VARIABLES) {
    issues.push({ severity: "error", part: "variables", message: `At most ${MAX_VARIABLES} variables.` });
  }
  for (const v of source.variables) {
    if (!VARIABLE_NAME.test(v.name)) {
      issues.push({ severity: "error", part: "variables", message: `\`${v.name || "(blank)"}\` is not a valid variable name.` });
      continue;
    }
    if (defined.has(v.name)) {
      issues.push({ severity: "error", part: "variables", message: `\`${v.name}\` is defined twice.` });
      continue;
    }
    for (const [label, value] of [["Default", v.defaultValue], ["Sample", v.sample]] as const) {
      if ((value?.length ?? 0) > MAX_VALUE_LENGTH) {
        issues.push({ severity: "error", part: "variables", message: `${label} for \`${v.name}\` is too long.` });
      }
    }
    if (v.required && !v.sample && v.defaultValue === undefined) {
      issues.push({
        severity: "warning",
        part: "variables",
        message: `\`${v.name}\` is required but has no sample value, so the preview and test send will fail on it.`,
      });
    }
    defined.set(v.name, v);
  }

  // Syntax and references, per part.
  const used = new Set<string>();
  for (const [part, text] of parts) {
    const { tokens, errors } = parse(text);
    for (const e of errors) issues.push({ severity: "error", part, ...e });
    for (const t of tokens) {
      if (t.kind !== "var") continue;
      used.add(t.name);
      if (!defined.has(t.name)) {
        issues.push({
          severity: "error",
          part,
          message: `\`{{${t.name}}}\` is used but not defined. Add it to the variables.`,
        });
      }
    }
  }

  for (const name of defined.keys()) {
    if (!used.has(name)) {
      issues.push({ severity: "warning", part: "variables", message: `\`${name}\` is defined but never used.` });
    }
  }

  // Content rules.
  if (!source.subject.trim()) {
    issues.push({ severity: "error", part: "subject", message: "Subject is required." });
  }
  if (/[\r\n]/.test(source.subject)) {
    issues.push({ severity: "error", part: "subject", message: "Subject must be a single line." });
  }
  if (source.subject.length > MAX_SUBJECT_LENGTH) {
    issues.push({ severity: "error", part: "subject", message: `Subject is longer than ${MAX_SUBJECT_LENGTH} characters.` });
  }
  if (!source.html.trim()) {
    issues.push({ severity: "error", part: "html", message: "HTML body is required." });
  }
  if (byteLength(source.html) > MAX_HTML_BYTES) {
    issues.push({ severity: "error", part: "html", message: "HTML body is larger than 512 KB." });
  }
  if (byteLength(source.text ?? "") > MAX_TEXT_BYTES) {
    issues.push({ severity: "error", part: "text", message: "Text body is larger than 256 KB." });
  }
  if (/<script[\s>]/i.test(source.html)) {
    issues.push({
      severity: "warning",
      part: "html",
      message: "`<script>` is stripped or blocked by every major email client, and can get mail flagged as spam.",
    });
  }
  if (!source.text?.trim()) {
    issues.push({
      severity: "warning",
      part: "text",
      message: "No plain-text version — one will be generated from the HTML. Writing your own usually reads better.",
    });
  }

  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === "error");

// ---------------------------------------------------------------------------
// Variable values (supplied at send time)
// ---------------------------------------------------------------------------

export interface ResolveResult {
  values: Record<string, string>;
  errors: string[];
}

/**
 * Checks caller-supplied values against the definitions and fills defaults.
 *
 * Strict both ways: a required variable with no value and no default is an
 * error, and so is a value for a variable the template does not define — a
 * typo like `frist_name` should fail the request, not silently send "Hi ,".
 * Values must be strings, numbers or booleans; objects, arrays and null are
 * refused rather than rendered as "[object Object]" or "null".
 */
export function resolveVariables(
  definitions: VariableDefinition[],
  supplied: Record<string, unknown> | undefined,
): ResolveResult {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  const input = supplied ?? {};
  const known = new Set(definitions.map((d) => d.name));

  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors.push(`\`${key}\` is not a variable of this template.`);
  }

  for (const def of definitions) {
    const raw = input[def.name];
    if (raw === undefined) {
      if (def.defaultValue !== undefined) values[def.name] = def.defaultValue;
      else if (def.required) errors.push(`\`${def.name}\` is required.`);
      else values[def.name] = "";
      continue;
    }
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
      errors.push(`\`${def.name}\` must be a string, number or boolean.`);
      continue;
    }
    const value = String(raw);
    if (value.length > MAX_VALUE_LENGTH) {
      errors.push(`\`${def.name}\` is longer than ${MAX_VALUE_LENGTH} characters.`);
      continue;
    }
    values[def.name] = value;
  }

  return { values, errors };
}

/** The template's sample data, for preview and test sends. */
export function sampleValues(definitions: VariableDefinition[]): Record<string, string> {
  return Object.fromEntries(
    definitions.flatMap((d) =>
      d.sample !== undefined && d.sample !== "" ? [[d.name, d.sample]] : [],
    ),
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function interpolate(source: string, values: Record<string, string>, encode: (v: string) => string) {
  return parse(source)
    .tokens.map((t) => (t.kind === "text" ? t.value : encode(values[t.name] ?? "")))
    .join("");
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** True when `text` was generated from the HTML rather than written. */
  textGenerated: boolean;
}

/**
 * Renders a template that has already passed `validateTemplate`, with values
 * that have already passed `resolveVariables`.
 */
export function render(source: TemplateSource, values: Record<string, string>): RenderedEmail {
  const subject = interpolate(source.subject, values, (v) => v.replace(/[\r\n]+/g, " ")).trim();
  const html = interpolate(source.html, values, escapeHtml);
  const written = source.text?.trim() ? interpolate(source.text, values, (v) => v) : null;

  return {
    subject,
    html,
    text: written ?? htmlToText(html),
    textGenerated: written === null,
  };
}

// ---------------------------------------------------------------------------
// Plain-text fallback
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower]!;
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return match;
  });
}

/**
 * A readable plain-text version of rendered HTML — FR-6 "plain-text fallback".
 *
 * Not a general HTML-to-text converter; it handles what transactional email
 * contains: paragraphs, headings, line breaks, lists, links (kept as
 * "text (url)" so they survive a text-only client) and entities. Styles,
 * scripts and comments are dropped entirely.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const inner = label.replace(/<[^>]+>/g, "").trim();
      return !inner || inner === href || href.startsWith("#") ? inner || href : `${inner} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|section|header|footer)>/gi, "\n\n")
    .replace(/<(p|div|h[1-6]|tr|table|ul|ol|blockquote|section|header|footer)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<[^>]+>/g, "");

  text = decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

// ---------------------------------------------------------------------------
// Inline content with variables (no stored template)
// ---------------------------------------------------------------------------

export interface InlineContent {
  subject: string;
  html?: string | undefined;
  text?: string | undefined;
}

export type InlineResult =
  | { ok: true; subject: string; html: string | undefined; text: string | undefined }
  | { ok: false; errors: string[] };

/**
 * Interpolates one-off content — the SRS §7 example, where `subject`/`html`/
 * `text` carry `{{first_name}}` and `variables` supplies it.
 *
 * Same strictness as a stored template, with the variable list taken from the
 * content itself: every `{{name}}` must be supplied, and every supplied
 * variable must be used. Unlike a template, no text part is generated — inline
 * callers get exactly the parts they sent.
 */
export function renderInline(
  content: InlineContent,
  supplied: Record<string, unknown>,
): InlineResult {
  const errors: string[] = [];
  const parts: Array<[TemplatePart, string | undefined]> = [
    ["subject", content.subject],
    ["html", content.html],
    ["text", content.text],
  ];

  const names = new Set<string>();
  for (const [part, source] of parts) {
    if (source === undefined) continue;
    const parsed = parse(source);
    for (const e of parsed.errors) errors.push(`${part} line ${e.line}, column ${e.column}: ${e.message}`);
    for (const t of parsed.tokens) if (t.kind === "var") names.add(t.name);
  }

  const definitions = [...names].map((name) => ({ name, required: true }));
  const resolved = resolveVariables(definitions, supplied);
  errors.push(
    ...resolved.errors.map((e) => e.replace("is not a variable of this template", "is not used in the subject, html or text")),
  );
  if (errors.length > 0) return { ok: false, errors };

  const v = resolved.values;
  const subject = interpolate(content.subject, v, (x) => x.replace(/[\r\n]+/g, " ")).trim();
  if (!subject) return { ok: false, errors: ["The rendered subject is empty."] };
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return { ok: false, errors: [`The rendered subject is longer than ${MAX_SUBJECT_LENGTH} characters.`] };
  }

  return {
    ok: true,
    subject,
    html: content.html === undefined ? undefined : interpolate(content.html, v, escapeHtml),
    text: content.text === undefined ? undefined : interpolate(content.text, v, (x) => x),
  };
}
