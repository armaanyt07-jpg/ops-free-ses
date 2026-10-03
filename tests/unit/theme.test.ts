/**
 * The light/dark switch. The palette for both themes lives in globals.css; these
 * keep the switch wired up everywhere a visitor can reach it, default to light
 * (so nobody gets a half-finished dark page by surprise), and stop coloured
 * text from being added without a dark-mode shade.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeToggle } from "@/components/theme/theme-toggle";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? tsxFiles(full) : full.endsWith(".tsx") ? [full] : [];
  });
}

describe("the switch", () => {
  it("renders an accessible button, with no theme chosen on the server", () => {
    const html = renderToStaticMarkup(createElement(ThemeToggle));
    expect(html).toContain('aria-label="Switch to dark mode"');
    expect(html).toContain('type="button"');
  });

  it("the whole app sits in a provider that defaults to light and sets the class", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("<ThemeProvider");
    expect(layout).toContain('attribute="class"');
    expect(layout).toContain('defaultTheme="light"');
    expect(layout).toContain("enableSystem={false}");
    // The server can't know the stored choice, so React must not complain.
    expect(layout).toContain("suppressHydrationWarning");
  });

  it("is reachable on the landing pages, the dashboard and the sign-in pages", () => {
    expect(read("src/components/landing/nav.tsx")).toContain("<ThemeToggle");
    expect(read("src/components/dashboard/app-nav.tsx")).toContain("<ThemeToggle");
    expect(read("src/components/auth/auth-shell.tsx")).toContain("<ThemeToggle");
  });

  it("the dark palette defines every colour token the light one does", () => {
    const css = read("src/app/globals.css");
    const block = (sel: string) => css.slice(css.indexOf(sel)).split("}")[0]!;
    // --radius is a size, not a colour, so it isn't repeated per theme.
    const tokens = (b: string) => [...b.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]).filter((t) => t !== "radius").sort();
    const light = tokens(block(":root {"));
    const dark = tokens(block(".dark {"));
    expect(dark).toEqual(light);
  });

  it("the Turnstile box follows the page theme", () => {
    expect(read("src/components/auth/turnstile-field.tsx")).toContain('classList.contains("dark")');
  });
});

describe("coloured text stays readable in dark mode", () => {
  // text-red-700 on a near-black page is too dim to read. Every dark-sensitive
  // shade needs a dark: counterpart on the same line.
  const risky = /(?<![\w:-])(text|bg)-(red|amber|emerald|green|orange|yellow)-(50|100|200|700|800|900)(?![\w-])/;

  it("has a dark: shade wherever a light-only colour class is used", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(root, "src"))) {
      read(file.slice(root.length + 1))
        .split("\n")
        .forEach((line, i) => {
          if (risky.test(line) && !line.includes("dark:")) offenders.push(`${file.slice(root.length + 1)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
