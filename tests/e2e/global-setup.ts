import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

import { AUTH_STATE_PATH, BASE_URL } from "./constants";

const EMPTY_STATE = { cookies: [], origins: [] };

/**
 * Signs in once with a persistent, already-existing E2E account and saves
 * the session, so authenticated specs start already signed in instead of
 * re-running the login form per test.
 *
 * Deliberately does not sign up a new account: this project's Supabase and
 * database are the real dev instances (see tests/e2e/README.md), and an
 * automated suite should not be creating rows in a real auth table on every
 * run, nor can it complete an email-confirmation step it can't see the
 * inbox for. Provide E2E_EMAIL / E2E_PASSWORD for an account you created and
 * confirmed yourself.
 *
 * On any failure (no credentials given, wrong password, unconfirmed email),
 * this writes an empty-but-valid storage state instead of throwing, so
 * authenticated specs skip cleanly (see hasValidAuthState) rather than the
 * whole run crashing.
 */
export default async function globalSetup() {
  mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });

  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    console.log("[e2e] E2E_EMAIL/E2E_PASSWORD not set — authenticated specs will skip.");
    writeFileSync(AUTH_STATE_PATH, JSON.stringify(EMPTY_STATE));
    return;
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    await context.storageState({ path: AUTH_STATE_PATH });
    console.log("[e2e] Signed in as", email);
  } catch (err) {
    console.warn(
      "[e2e] Could not sign in with E2E_EMAIL/E2E_PASSWORD — authenticated specs will skip.",
      err instanceof Error ? err.message : err,
    );
    writeFileSync(AUTH_STATE_PATH, JSON.stringify(EMPTY_STATE));
  } finally {
    await browser.close();
  }
}
