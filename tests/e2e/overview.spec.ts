import { expect, test } from "@playwright/test";

import { BASE_URL, hasValidAuthState } from "./constants";

test.skip(!hasValidAuthState(), "Requires a signed-in E2E account — see tests/e2e/README.md");

test.describe("overview", () => {
  test("the environment badge agrees with the sidebar selector", async ({ page }) => {
    await page.goto("/dashboard");
    const selected = await page.locator("aside select#env-switcher").inputValue();
    await expect(page.locator("main").getByTestId("environment-badge")).toHaveText(selected);
  });

  test("incomplete setup steps navigate directly to their configuration page", async ({ page }) => {
    await page.goto("/dashboard");

    const setupLinks = page.locator("a", { hasText: "Set up" });
    const count = await setupLinks.count();
    test.skip(count === 0, "This environment is already fully configured — nothing to check");

    const href = await setupLinks.first().getAttribute("href");
    expect(href, "setup row has no href").toBeTruthy();

    await setupLinks.first().click();
    await expect(page).toHaveURL(new URL(href!, BASE_URL).toString());
  });

  test("the recent-activity empty state offers a real action, and isn't shown alongside real data", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const emptyState = page.getByText(/^Nothing sent in (staging|production) yet$/);
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
