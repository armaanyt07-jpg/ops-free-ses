import { readFileSync } from "node:fs";

import { config as loadEnv } from "dotenv";

// The Playwright test runner is a separate Node process from `next dev` and
// does not get Next's automatic .env.local loading, so load it explicitly.
// This must happen before any of the constants below read process.env.
loadEnv({ path: ".env.local" });

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export const AUTH_STATE_PATH = "playwright/.auth/user.json";

/**
 * A real, already-existing, already-confirmed account in this project's
 * Supabase instance. This suite never signs one up itself — see
 * tests/e2e/README.md for why.
 */
export const hasE2EAccount = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

/**
 * A real AWS credential (SES sandbox is fine) used only to prove the send
 * pipeline end to end via SES's mailbox simulator addresses.
 */
export const hasE2EAwsCredentials = Boolean(
  process.env.E2E_AWS_ACCESS_KEY_ID &&
    process.env.E2E_AWS_SECRET_ACCESS_KEY &&
    process.env.E2E_AWS_REGION,
);

/**
 * Whether global-setup actually produced a signed-in session — distinct from
 * `hasE2EAccount`, which only checks that credentials were *supplied*. If
 * sign-in failed (wrong password, unconfirmed email, account doesn't exist),
 * global-setup still writes a valid-but-empty storage state rather than
 * throwing, so every authenticated spec skips cleanly instead of the whole
 * run crashing.
 */
export function hasValidAuthState(): boolean {
  try {
    const raw = JSON.parse(readFileSync(AUTH_STATE_PATH, "utf-8")) as {
      cookies?: unknown[];
      origins?: unknown[];
    };
    return (raw.cookies?.length ?? 0) > 0 || (raw.origins?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
