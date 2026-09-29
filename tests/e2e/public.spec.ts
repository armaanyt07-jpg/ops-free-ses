import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Always a fresh, unauthenticated context here, regardless of whether an E2E
// account is configured for the authenticated specs — these checks are
// specifically about what an unauthenticated visitor can and can't see.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("unauthenticated access", () => {
  for (const path of ["/dashboard", "/dashboard/activity", "/dashboard/health", "/dashboard/aws"]) {
    test(`${path} redirects to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe("login page", () => {
  test("renders the sign-in form and links to signup", async ({ page }) => {
    await page.goto("/login");
    // "Sign in" also appears as the button label, so scope to the card title
    // rather than a plain text match, which would be ambiguous.
    await expect(page.locator('[data-slot="card-title"]')).toHaveText("Sign in");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create one" })).toHaveAttribute("href", "/signup");
  });

  test("rejects bad credentials with a generic error, not an account-enumeration hint", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(`nonexistent-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Those credentials were not accepted.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("has no serious or critical accessibility violations", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
});

test.describe("signup page", () => {
  test("renders the sign-up form and links to login", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.locator('[data-slot="card-title"]')).toHaveText("Create an account");
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});
