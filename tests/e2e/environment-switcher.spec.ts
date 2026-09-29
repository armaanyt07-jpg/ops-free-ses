import { expect, test } from "@playwright/test";

import { hasValidAuthState } from "./constants";

test.skip(!hasValidAuthState(), "Requires a signed-in E2E account — see tests/e2e/README.md");

/**
 * Regression coverage for the bug where the sidebar's environment selector
 * could show one environment while the page content showed another: the
 * desktop <select> is an uncontrolled input inside a component that stays
 * mounted for the whole dashboard session, so a change made anywhere else
 * (e.g. the mobile switcher) never reached it without a `key` forcing a
 * remount. Fixed in src/components/dashboard/app-nav.tsx.
 */
test.describe("environment switcher", () => {
  test("switching via the sidebar select updates the page and the badge together", async ({ page }) => {
    await page.goto("/dashboard");

    const select = page.locator("aside select#env-switcher");
    const pageBadge = page.locator("main").getByTestId("environment-badge");
    const current = await select.inputValue();
    const other = current === "production" ? "staging" : "production";

    await select.selectOption(other);
    await expect(select).toHaveValue(other);
    await expect(pageBadge).toHaveText(other);

    // Navigate elsewhere and back via client-side routing (no full reload)
    // and confirm the select and the page still agree with each other.
    await page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(/\/dashboard\/activity/);
    await expect(select).toHaveValue(other);

    await page.getByRole("navigation", { name: "Dashboard" }).getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(select).toHaveValue(other);
    await expect(pageBadge).toHaveText(other);

    // Restore the original environment so this test is repeatable and
    // doesn't leave the shared test account switched over for other runs.
    await select.selectOption(current);
    await expect(pageBadge).toHaveText(current);
  });

  test("switching via the mobile menu is reflected in the desktop select afterward", async ({ page }) => {
    await page.goto("/dashboard");
    const desktopSelect = page.locator("aside select#env-switcher");
    const current = await desktopSelect.inputValue();
    const other = current === "production" ? "staging" : "production";

    await page.setViewportSize({ width: 375, height: 800 });
    await page.getByRole("button", { name: "Open menu" }).click();
    const mobileSelect = page.locator("#mobile-nav select#env-switcher");
    await mobileSelect.selectOption(other);
    await expect(page.locator("main").getByTestId("environment-badge")).toHaveText(other);

    // Back to desktop width, without ever touching the desktop <select>
    // directly — this is exactly the shipped bug's shape.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(desktopSelect).toHaveValue(other);

    await desktopSelect.selectOption(current);
    await expect(page.locator("main").getByTestId("environment-badge")).toHaveText(current);
  });
});
