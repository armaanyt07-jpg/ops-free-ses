import { defineConfig, devices } from "@playwright/test";

import { AUTH_STATE_PATH, BASE_URL } from "./tests/e2e/constants";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 30_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Authenticated by default; public.spec.ts explicitly resets this to a
    // fresh/anonymous context for the unauthenticated-access checks.
    storageState: AUTH_STATE_PATH,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Reuses an already-running `next dev` (e.g. the one you're developing
    // against) instead of starting a second instance — see the project's
    // "never build over a running dev server" rule; this never runs `next
    // build`, only checks whether baseURL already responds.
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
