import { expect, test } from "@playwright/test";

import { hasE2EAwsCredentials, hasValidAuthState } from "./constants";

test.skip(!hasValidAuthState(), "Requires a signed-in E2E account — see tests/e2e/README.md");
test.skip(
  !hasE2EAwsCredentials,
  "Requires E2E_AWS_ACCESS_KEY_ID/E2E_AWS_SECRET_ACCESS_KEY/E2E_AWS_REGION — see tests/e2e/README.md",
);

/**
 * The one test in this suite that touches real AWS: saves a real credential
 * (SES sandbox is enough) and sends to SES's mailbox simulator address,
 * which AWS accepts even in the sandbox without actually delivering
 * anywhere. Saving for an environment that already has a credential
 * replaces it with the same values, so this is safe to re-run.
 *
 * This only asserts the message was queued and reached Activity — not that
 * SES ultimately delivered it, since that also depends on the "From" address
 * being a verified identity, which this suite doesn't assume.
 */
test("a real send through the dashboard reaches Activity", async ({ page }) => {
  await page.goto("/dashboard/aws");
  await page.getByLabel("AWS region").fill(process.env.E2E_AWS_REGION!);
  await page.getByLabel("Access key ID").fill(process.env.E2E_AWS_ACCESS_KEY_ID!);
  await page.getByLabel("Secret access key").fill(process.env.E2E_AWS_SECRET_ACCESS_KEY!);
  await page.getByRole("button", { name: "Validate & save" }).click();
  await expect(page.getByText("active", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/dashboard");
  const subject = `E2E test ${Date.now()}`;
  await page.getByLabel("From").fill(process.env.E2E_FROM_ADDRESS ?? "e2e-test@example.com");
  await page.getByLabel("To").fill("success@simulator.amazonses.com");
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Message").fill("Sent by the automated E2E suite.");
  await page.getByRole("button", { name: /^Send in/ }).click();

  // The confirmation text shares a container with the "Follow this message"
  // link, so this is a substring match rather than an anchored one.
  await expect(page.getByText(/Queued in (staging|production)\./)).toBeVisible({ timeout: 15_000 });

  await page.goto("/dashboard/activity");
  await expect(page.getByText(subject)).toBeVisible({ timeout: 15_000 });
});
