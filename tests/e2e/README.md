# End-to-end tests

Playwright specs that drive a real browser against the real running app —
different from `tests/unit` and `tests/integration` (Vitest + PGlite, an
in-memory fake Postgres). These hit whatever `.env.local` points at, which in
this project is a **real Supabase project and a real Postgres database**, not
a disposable test instance.

## Run it

```bash
npm run test:e2e          # headless
npm run test:e2e:ui       # Playwright's interactive UI mode
npm run test:e2e:report   # open the last HTML report
```

The config reuses an already-running `npm run dev` on port 3000 if there is
one; otherwise it starts one. It never runs `next build`.

## Why some specs skip by default

Out of the box, most specs **skip with a clear reason** instead of failing.
That's deliberate:

- **This suite never signs up a new account.** Signing up hits the real
  Supabase `auth.users` table, and if the project requires email
  confirmation, an automated run has no inbox to confirm from — it would
  just hang or fail. Instead, provide `E2E_EMAIL` / `E2E_PASSWORD` for an
  account you created and confirmed yourself (see `.env.example`). Global
  setup (`global-setup.ts`) signs in once and reuses that session for every
  authenticated spec.
- **`send-flow.spec.ts` never runs by default.** It saves a real AWS
  credential and sends through SES. Provide `E2E_AWS_ACCESS_KEY_ID` /
  `E2E_AWS_SECRET_ACCESS_KEY` / `E2E_AWS_REGION` to opt in — an SES sandbox
  credential is enough, since it targets `success@simulator.amazonses.com`,
  which AWS accepts even in the sandbox without delivering anywhere real.
  Saving a credential for an environment that already has one just replaces
  it with the same values, so it's safe to re-run.

If sign-in fails for any reason (wrong password, unconfirmed email, the
account doesn't exist), `global-setup.ts` doesn't throw and take down the
whole run — it logs a warning and every authenticated spec skips cleanly.

## What's covered without any of that

`public.spec.ts` needs no account at all: unauthenticated redirects, the
login/signup pages render, bad credentials get a generic rejection, and an
axe accessibility scan of the login page.

## Files

| File | Covers |
| --- | --- |
| `public.spec.ts` | Unauthenticated redirects, login/signup pages, a11y |
| `navigation.spec.ts` | Every sidebar route loads, active-link state, phone-width overflow, mobile menu, a11y on Overview |
| `overview.spec.ts` | Setup checklist links to the right page, empty-state action, dead-letter explanation and link |
| `send-flow.spec.ts` | Real AWS credential save + real send reaching Activity (opt-in) |

## A note on the test account

Use an account that isn't otherwise important to you — the send-flow spec
queues real messages
tagged with an `E2E test <timestamp>` subject you can tell apart from real
activity.
