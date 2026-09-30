import { expect, test } from "@playwright/test";

import { hasValidAuthState } from "./constants";

test.skip(!hasValidAuthState(), "Requires a signed-in E2E account — see tests/e2e/README.md");

test.describe("overview", () => {
  test("there is one environment: no switcher, no staging (Phase 8)", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("#env-switcher")).toHaveCount(0);
    await expect(page.getByText(/staging/i)).toHaveCount(0);
  });

  test("shows either the setup guide or the dashboard, never both", async ({ page }) => {
    await page.goto("/dashboard");
    const guide = await page.getByText("Let's get you sending").isVisible();
    const dashboard = await page.getByText("Volume by outcome").isVisible();
    expect(guide !== dashboard, "exactly one of the two").toBe(true);
  });

  test("the recent-activity empty state offers a real action, and isn't shown alongside real data", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const emptyState = page.getByText(/^Nothing sent yet$/);
    const isEmpty = await emptyState.isVisible().catch(() => false);

    if (isEmpty) {
      await expect(page.getByRole("link", { name: "Send your first message" })).toHaveAttribute(
        "href",
        "#send-test",
      );
    } else {
      await expect(emptyState).toHaveCount(0);
    }
  });

  test("the Dead-lettered queue metric explains itself and links to the health page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/Exhausted retries or permanently rejected/)).toBeVisible();

    const viewQueue = page.getByRole("link", { name: "View queue →" });
    if (await viewQueue.isVisible().catch(() => false)) {
      await viewQueue.click();
      await expect(page).toHaveURL(/\/dashboard\/health#dead-letter/);
      await expect(page.getByText("Dead letter", { exact: true })).toBeInViewport();
    }
  });
});
