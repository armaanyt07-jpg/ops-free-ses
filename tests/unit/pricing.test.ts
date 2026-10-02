/**
 * The pricing page is display only, but it makes promises (prices, quotas, the
 * beta being free). These pin the numbers we agreed and the places they must
 * stay consistent with.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ANNUAL_MONTHS_BILLED, PAID_PLANS_OPEN, PLANS, annualPrice } from "@/lib/pricing/plans";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("plans", () => {
  it("are Free, Pro and Scale at $0, $15 and $49", () => {
    expect(PLANS.map((p) => [p.id, p.monthly])).toEqual([
      ["free", 0],
      ["pro", 15],
      ["scale", 49],
    ]);
  });

  it("quote their email quotas in the agreed order", () => {
    expect(PLANS.map((p) => p.emails)).toEqual([
      "3,000 emails / month",
      "50,000 emails / month",
      "250,000 emails / month",
    ]);
  });

  it("give two months free on annual billing", () => {
    expect(ANNUAL_MONTHS_BILLED).toBe(10);
    expect(annualPrice(15)).toBe(150);
    expect(annualPrice(49)).toBe(490);
  });

  it("show prices in dollars only", () => {
    const shown = [read("src/components/pricing/pricing-plans.tsx"), read("src/app/pricing/page.tsx")].join("\n");
    expect(shown).not.toMatch(/₹|INR|\bRs\.?\s?\d/);
  });
});

describe("while billing does not exist", () => {
  it("paid plans stay closed", () => {
    expect(PAID_PLANS_OPEN).toBe(false);
  });

  it("the Terms still say the beta is free", () => {
    expect(read("src/app/terms/page.tsx")).toMatch(/During the beta the service is free/);
  });
});

describe("wiring", () => {
  it("/pricing is public so signed-out visitors aren't sent to /login", () => {
    expect(read("src/lib/supabase/middleware.ts")).toMatch(/PUBLIC_PATHS = \[[^\]]*"\/pricing"/);
  });

  it("the nav and footer link to it, and the landing page renders the section", () => {
    expect(read("src/components/landing/nav.tsx")).toContain('href="/pricing"');
    expect(read("src/components/landing/footer.tsx")).toContain('href: "/pricing"');
    expect(read("src/app/page.tsx")).toContain("<Pricing />");
  });
});
