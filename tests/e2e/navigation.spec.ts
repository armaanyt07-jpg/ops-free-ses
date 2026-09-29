import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { hasValidAuthState } from "./constants";

test.skip(!hasValidAuthState(), "Requires a signed-in E2E account — see tests/e2e/README.md");

const ROUTES = [
  "/dashboard",
  "/dashboard/activity",
  "/dashboard/errors",
  "/dashboard/templates",
  "/dashboard/domains",
  "/dashboard/suppressions",
  "/dashboard/webhooks",
  "/dashboard/api-keys",
  "/dashboard/aws",
  "/dashboard/sandbox",
  "/dashboard/health",
];

test.describe("dashboard navigation", () => {
  for (const route of ROUTES) {
    test(`${route} loads with the dashboard shell, not an error page`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.ok(), `${route} responded ${response?.status()}`).toBeTruthy();
      await expect(page.getByRole("navigation", { name: "Dashboard" })).toBeVisible();
    });
  }

  test("the active sidebar link matches the current page", async ({ page }) => {
    await page.goto("/dashboard/domains");
    const active = page.getByRole("navigation", { name: "Dashboard" }).locator('[aria-current="page"]');
    await expect(active).toHaveText("Domains");
  });
});

test.describe("responsive layout", () => {
  test("no horizontal overflow at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "page is wider than the viewport at 375px").toBeLessThanOrEqual(1);
  });

  test("the mobile menu opens and navigates", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: "Domains" }).click();
    await expect(page).toHaveURL(/\/dashboard\/domains/);
  });
});

test.describe("accessibility", () => {
  test("Overview has no serious or critical violations", async ({ page }) => {
    await page.goto("/dashboard");
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
});
