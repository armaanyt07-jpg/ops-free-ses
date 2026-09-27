import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  hasErrors,
  htmlToText,
  parse,
  referencedVariables,
  render,
  renderInline,
  resolveVariables,
  sampleValues,
  validateTemplate,
  type TemplateSource,
  type VariableDefinition,
} from "@/lib/templates/engine";

/**
 * The template engine — FR-6 interpolation, validation, plain-text fallback,
 * and SRS §9 "validate and constrain template variables". Pure, so every rule
 * is pinned here against exact strings.
 */
const vars = (...names: string[]): VariableDefinition[] =>
  names.map((name) => ({ name, required: true, sample: `<${name}>` }));

const tpl = (over: Partial<TemplateSource> = {}): TemplateSource => ({
  subject: "Hi {{first_name}}",
  html: "<p>Hello {{ first_name }}</p>",
  text: "Hello {{first_name}}",
  variables: vars("first_name"),
  ...over,
});

describe("parse", () => {
  it("finds variables, tolerating whitespace inside the braces", () => {
    expect(referencedVariables("{{a}} {{ b }} {{a}}")).toEqual(["a", "b"]);
  });

  it("treats a lone `}}` and single braces as text", () => {
    expect(parse("a }} b { c }").errors).toEqual([]);
  });

  it.each([
    ["{{ first name }}", /not a valid variable/],
    ["{{user.name}}", /no dots/],
    ["{{#if x}}", /no dots, spaces, helpers or logic/],
    ["{{ }}", /Empty/],
    ["{{{raw}}}", /unescaped output/],
    ["Hi {{name", /never closed/],
    ["{{a {{b}}", /never closed/],
  ])("rejects %j", (source, message) => {
    const { errors } = parse(source);
    expect(errors[0]?.message).toMatch(message);
  });

  it("reports line and column", () => {
    const { errors } = parse("line one\n  {{bad name}}");
    expect(errors[0]).toMatchObject({ line: 2, column: 3 });
  });
});

describe("validateTemplate", () => {
  const errors = (s: TemplateSource) => validateTemplate(s).filter((i) => i.severity === "error").map((i) => i.message);
  const warnings = (s: TemplateSource) => validateTemplate(s).filter((i) => i.severity === "warning").map((i) => i.message);

  it("accepts a well-formed template", () => {
    expect(hasErrors(validateTemplate(tpl()))).toBe(false);
  });

  it("errors on a variable used but not defined, in any part", () => {
    expect(errors(tpl({ html: "<p>{{first_name}} {{plan}}</p>" }))[0]).toMatch(/plan.*not defined/);
    expect(errors(tpl({ subject: "{{oops}}" }))[0]).toMatch(/oops.*not defined/);
  });

  it("errors on syntax, invalid and duplicate definitions", () => {
    expect(errors(tpl({ html: "{{first_name" }))[0]).toMatch(/never closed/);
    expect(errors(tpl({ variables: [...vars("first_name"), { name: "2bad", required: false }] }))).toContainEqual(
      expect.stringMatching(/not a valid variable name/),
    );
    expect(errors(tpl({ variables: [...vars("first_name"), ...vars("first_name")] }))).toContainEqual(
      expect.stringMatching(/defined twice/),
    );
  });

  it("errors on an empty, multi-line or over-long subject and an empty body", () => {
    expect(errors(tpl({ subject: " " }))).toContainEqual(expect.stringMatching(/Subject is required/));
    expect(errors(tpl({ subject: "a\nb" }))).toContainEqual(expect.stringMatching(/single line/));
    expect(errors(tpl({ subject: "x".repeat(999) }))).toContainEqual(expect.stringMatching(/998/));
    expect(errors(tpl({ html: "" }))).toContainEqual(expect.stringMatching(/HTML body is required/));
  });

  it("warns — without blocking — on unused variables, scripts, missing text, and required-without-sample", () => {
    const w = warnings(
      tpl({
        html: "<p>{{first_name}}</p><script>x()</script>",
        text: "",
        variables: [{ name: "first_name", required: true }, { name: "unused", required: false }],
      }),
    );
    expect(w).toContainEqual(expect.stringMatching(/unused.*never used/));
    expect(w).toContainEqual(expect.stringMatching(/script/));
    expect(w).toContainEqual(expect.stringMatching(/No plain-text version/));
    expect(w).toContainEqual(expect.stringMatching(/first_name.*no sample/));
  });

  it("errors on an oversized body", () => {
    expect(errors(tpl({ html: `{{first_name}}${"x".repeat(600_000)}` }))).toContainEqual(expect.stringMatching(/512 KB/));
  });
});

describe("resolveVariables", () => {
  const defs: VariableDefinition[] = [
    { name: "first_name", required: true },
    { name: "plan", required: false, defaultValue: "Free" },
    { name: "note", required: false },
  ];

  it("fills defaults and blanks for optional variables", () => {
    expect(resolveVariables(defs, { first_name: "Ana" })).toEqual({
      values: { first_name: "Ana", plan: "Free", note: "" },
      errors: [],
    });
  });

  it("refuses a missing required variable", () => {
    expect(resolveVariables(defs, {}).errors).toEqual(["`first_name` is required."]);
  });

  it("refuses unknown variables — a typo must not send 'Hi ,'", () => {
    expect(resolveVariables(defs, { first_name: "a", frist_name: "b" }).errors).toEqual([
      "`frist_name` is not a variable of this template.",
    ]);
  });

  it("stringifies numbers and booleans; refuses objects, arrays and null", () => {
    expect(resolveVariables(defs, { first_name: 42, plan: true }).values).toMatchObject({ first_name: "42", plan: "true" });
    for (const bad of [{ a: 1 }, [1], null]) {
      expect(resolveVariables(defs, { first_name: bad }).errors[0]).toMatch(/string, number or boolean/);
    }
  });

  it("caps value length", () => {
    expect(resolveVariables(defs, { first_name: "x".repeat(10_001) }).errors[0]).toMatch(/longer than/);
  });
});

describe("render — output encoding by context", () => {
  const evil = `<img src=x onerror=alert(1)>"'&`;

  it("HTML-escapes values in the HTML body, so a value cannot inject markup", () => {
    const out = render(tpl(), { first_name: evil });
    expect(out.html).toBe("<p>Hello &lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p>");
    expect(out.html).not.toContain("<img");
  });

  it("keeps values literal in the text body", () => {
    expect(render(tpl(), { first_name: evil }).text).toBe(`Hello ${evil}`);
  });

  it("strips CR/LF from values in the subject — no header injection", () => {
    const out = render(tpl(), { first_name: "Bob\r\nBcc: victim@example.com" });
    expect(out.subject).toBe("Hi Bob Bcc: victim@example.com");
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it("does not re-interpret braces that arrive inside a value", () => {
    expect(render(tpl(), { first_name: "{{first_name}}" }).text).toBe("Hello {{first_name}}");
  });

  it("generates the text part from the HTML when none is written", () => {
    const out = render(tpl({ text: "" }), { first_name: "Ana" });
    expect(out).toMatchObject({ text: "Hello Ana", textGenerated: true });
    expect(render(tpl(), { first_name: "Ana" }).textGenerated).toBe(false);
  });
});

describe("htmlToText — the plain-text fallback", () => {
  it("keeps structure, links and entities; drops styles, scripts and comments", () => {
    const html = `<html><head><style>p{color:red}</style><title>t</title></head><body>
      <!-- hidden -->
      <h1>Welcome&nbsp;Ana</h1>
      <p>Line one<br>line two &amp; more</p>
      <ul><li>First</li><li>Second</li></ul>
      <p><a href="https://example.com/confirm">Confirm email</a></p>
      <p><a href="https://example.com">https://example.com</a></p>
      <script>track()</script>
    </body></html>`;
    expect(htmlToText(html)).toBe(
      [
        "Welcome Ana",
        "",
        "Line one",
        "line two & more",
        "",
        "- First",
        "- Second",
        "",
        "Confirm email (https://example.com/confirm)",
        "",
        "https://example.com",
      ].join("\n"),
    );
  });

  it("decodes numeric entities", () => {
    expect(htmlToText("<p>&#8364;5 &#x2713;</p>")).toBe("€5 ✓");
  });
});

describe("renderInline — the SRS §7 example", () => {
  it("interpolates inline subject/html/text with the supplied variables", () => {
    const r = renderInline(
      { subject: "Welcome {{first_name}}", html: "<h1>Hello {{first_name}}</h1>", text: "Hello {{first_name}}" },
      { first_name: "<Alice>" },
    );
    expect(r).toEqual({
      ok: true,
      subject: "Welcome <Alice>",
      html: "<h1>Hello &lt;Alice&gt;</h1>",
      text: "Hello <Alice>",
    });
  });

  it("requires every referenced variable and rejects unused ones", () => {
    expect(renderInline({ subject: "Hi {{a}}", text: "{{b}}" }, { a: "1" })).toEqual({
      ok: false,
      errors: ["`b` is required."],
    });
    const unused = renderInline({ subject: "Hi", text: "x" }, { a: "1" });
    expect(unused.ok === false && unused.errors[0]).toMatch(/not used in the subject, html or text/);
  });

  it("reports syntax errors with the part and position", () => {
    const r = renderInline({ subject: "Hi {{a b}}" }, {});
    expect(r.ok === false && r.errors[0]).toMatch(/^subject line 1, column 4/);
  });

  it("leaves absent parts absent — no generated text for inline sends", () => {
    const r = renderInline({ subject: "Hi {{a}}", html: "<b>{{a}}</b>" }, { a: "x" });
    expect(r.ok && r.text).toBeUndefined();
  });

  it("refuses a subject that renders empty", () => {
    expect(renderInline({ subject: "{{a}}", text: "x" }, { a: " " })).toEqual({
      ok: false,
      errors: ["The rendered subject is empty."],
    });
  });
});

describe("sample data", () => {
  it("collects non-empty samples", () => {
    expect(
      sampleValues([
        { name: "a", required: true, sample: "1" },
        { name: "b", required: false, sample: "" },
        { name: "c", required: false },
      ]),
    ).toEqual({ a: "1" });
  });

  it("escapeHtml covers all five characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
