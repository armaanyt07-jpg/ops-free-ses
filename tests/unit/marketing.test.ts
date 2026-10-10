/**
 * The public tools and blog are how strangers find the product. These pin the
 * numbers they quote, the input they accept, and that every page listed in a
 * registry exists and is reachable signed out.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseDkimInput } from "@/lib/dns/dkim-input";
import { POSTS } from "@/lib/marketing/posts";
import { TOOLS } from "@/lib/marketing/tools";
import { opsFreeCost, resendCost } from "@/lib/pricing/compare";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("cost comparison", () => {
  it("is only Amazon's $0.10 per 1,000, because Ops-Free is free at any volume", () => {
    expect(opsFreeCost(3_000)).toEqual({ opsFree: 0, ses: 0.3, total: 0.3 });
    expect(opsFreeCost(50_000)).toEqual({ opsFree: 0, ses: 5, total: 5 });
    expect(opsFreeCost(1_000_000).total).toBe(100);
    expect(opsFreeCost(10_000_000).opsFree).toBe(0);
  });

  it("picks the cheapest Resend plan for a volume, overage included", () => {
    expect(resendCost(50_000)).toEqual({ tier: "Pro 50k", total: 20 });
    expect(resendCost(100_000)).toEqual({ tier: "Pro 100k", total: 35 });
    expect(resendCost(1_000_000)).toEqual({ tier: "Scale 1M", total: 650 });
    // 120k: Pro 100k + 20 x $0.90 = $53, cheaper than the $160 Scale 200k.
    expect(resendCost(120_000)).toEqual({ tier: "Pro 100k", total: 53 });
  });

  it("keeps charging overage on the largest published plan instead of inventing a tier", () => {
    expect(resendCost(2_500_000)?.tier).toBe("Scale 2.5M");
    expect(resendCost(2_500_001)?.tier).toBe("Scale 2.5M");
  });

  it("tolerates nonsense input", () => {
    expect(opsFreeCost(-5).total).toBe(0);
    expect(resendCost(0)).toEqual({ tier: "Free", total: 0 });
  });
});

describe("DKIM input", () => {
  const token = "abcdef1234567890abcdef1234567890";

  it("accepts a bare token, a record name or a target", () => {
    expect(parseDkimInput(token).tokens).toEqual([token]);
    expect(parseDkimInput(`${token}._domainkey.example.com`).tokens).toEqual([token]);
    expect(parseDkimInput(`${token}.dkim.amazonses.com.`).tokens).toEqual([token]);
  });

  it("splits on whitespace and commas, and drops duplicates", () => {
    const b = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(parseDkimInput(`${token}, ${b}\n${token}`).tokens).toEqual([token, b]);
  });

  it("reports what it can't read instead of ignoring it", () => {
    expect(parseDkimInput("not a token!").invalid).toEqual(["not", "a", "token!"]);
    expect(parseDkimInput("").tokens).toEqual([]);
  });
});

describe("pages", () => {
  it("every tool and post in a registry has a page", () => {
    for (const t of TOOLS) expect(existsSync(join(root, `src/app/tools/${t.slug}/page.tsx`)), t.slug).toBe(true);
    for (const p of POSTS) expect(existsSync(join(root, `src/app/blog/${p.slug}/page.tsx`)), p.slug).toBe(true);
  });

  it("are public, so signed-out visitors aren't sent to sign in", () => {
    const paths = read("src/lib/supabase/middleware.ts");
    expect(paths).toMatch(/PUBLIC_PATHS = \[[^\]]*"\/tools"/);
    expect(paths).toMatch(/PUBLIC_PATHS = \[[^\]]*"\/blog"/);
  });

  it("keep the sitemap and robots.txt public, or search engines are sent to the login page", () => {
    const paths = read("src/lib/supabase/middleware.ts");
    expect(paths).toMatch(/PUBLIC_PATHS = \[[^\]]*"\/sitemap\.xml"/);
    expect(paths).toMatch(/PUBLIC_PATHS = \[[^\]]*"\/robots\.txt"/);
  });

  it("are linked from the footer and the nav", () => {
    const footer = read("src/components/landing/footer.tsx");
    for (const t of TOOLS) expect(footer).toContain(`/tools/${t.slug}`);
    expect(footer).toContain('href: "/blog"');
    expect(read("src/components/landing/nav.tsx")).toContain('href="/blog"');
  });

  it("show no pricing while Ops-Free is free for everyone; old /pricing links go home", () => {
    expect(existsSync(join(root, "src/app/pricing"))).toBe(false);
    for (const f of [
      "src/components/landing/nav.tsx",
      "src/components/landing/footer.tsx",
      "src/components/marketing/prose.tsx",
      "src/app/sitemap.ts",
    ]) {
      expect(read(f), f).not.toContain('"/pricing"');
    }
    expect(read("src/app/page.tsx")).not.toContain("Pricing");
    expect(read("next.config.ts")).toContain('{ source: "/pricing", destination: "/", permanent: false }');
  });

  it("each end with the call to action, so every visit has a next step", () => {
    for (const p of POSTS) expect(read(`src/app/blog/${p.slug}/page.tsx`)).toContain("<Article");
    for (const t of TOOLS) expect(read(`src/app/tools/${t.slug}/page.tsx`)).toContain("<SkipItCta");
  });
});

describe("the DNS checker route", () => {
  const route = read("src/app/api/tools/dns-check/route.ts");

  it("is rate limited before any lookup runs", () => {
    expect(route.indexOf("checkLimit")).toBeGreaterThan(-1);
    expect(route.indexOf("checkLimit")).toBeLessThan(route.indexOf("checkDns("));
  });

  it("stores nothing and never touches AWS or the database", () => {
    expect(route).not.toMatch(/getDb|@\/db|@aws-sdk|server\/credentials/);
  });
});
