# Phase 8 — Guided onboarding and setup automation

Status: **code-complete; the AWS automation is unproven against real AWS**
until the app is deployed (SNS cannot call localhost). 687 tests pass;
migrations `0006`–`0008` are applied.

## Why

A browser walkthrough (2026-09-30) showed that setup was the product's
weakest point: the Overview was a monitoring screen full of zeroes, the IAM
step expected AWS knowledge, events meant four ordered manual steps in the
SNS and SES consoles, and every step had to be repeated for staging. Goal:
**the user connects AWS and sends**; the app does the rest.

## Scope → where it lives

| Scope item | Deliverable |
| --- | --- |
| Guided first-run setup | `src/components/dashboard/setup-guide.tsx`. The Overview *is* the setup guide until the environment has sent something: connect AWS → verify domain → API key → test send → (optional) events, each done in place |
| Copy-paste IAM | `src/lib/aws/iam-policy.ts` (one policy for landing page, setup guide, AWS page), `iam-setup.tsx` (console link + policy + copy) |
| One environment | Staging removed from the product (see Decisions). `src/server/environment.ts` returns production; no switcher, pickers, badges or wording; actions ignore any `environment` a form posts |
| One-click API key | `createQuickKey` in `src/app/dashboard/actions.ts`; the secret and a ready `curl` stay on screen after the page refreshes (`QuickKeyStep` stays mounted) |
| One-click events | `src/lib/aws/events.ts` (AWS calls), `src/server/events-setup.ts` (order + bookkeeping), `ConnectEventsButton`; Webhooks page leads with it, manual steps collapsed |
| Route 53 DNS | `src/lib/aws/route53.ts`, called from `onboardDomain` |
| Copyable DNS records | `src/components/dashboard/dns-records.tsx` (Domains page and setup guide) |
| Landing page | "Get started" steps rewritten for the new flow, policy from the shared module |
| No domain? Email address | `email_identities` table (migration `0007`, RLS on), `src/server/email-identities.ts`; SES emails a confirmation link, status refreshed on "I've clicked the link" and on page load (15 s cooldown), no background poller. Offered in setup step 2 and on the Domains page; works for going live, with a note that a domain improves inbox placement |
| Hosting subdomains | `hostingPlatform()` in `src/lib/dns/checks.ts`: `*.vercel.app`, `*.netlify.app`, `*.github.io`… get an explanation (the platform owns their DNS) instead of an SES error |

## How "Connect events" works

With the environment's stored credential, in order:

1. `sns:CreateTopic` `ops-free-ses-events` (returns the existing one if present).
2. Register the ARN (marked `managed`, with its environment) — **before**
   subscribing, because the webhook refuses to confirm unregistered topics.
3. `sns:Subscribe` the HTTPS webhook (`PUBLIC_APP_URL` or the request host);
   the existing webhook confirms it automatically.
4. SES configuration set `ops-free` with an SNS event destination for
   BOUNCE, COMPLAINT, DELIVERY (updated in place if it exists).
5. Set it as the default configuration set of each of the environment's
   domains; domains added later get it in `onboardDomain`.

Every step is idempotent, so pressing it again repairs a half-finished setup.
The send path is unchanged: identity default configuration sets apply without
`SendEmail` naming one, and the webhook already parsed the configuration-set
event format. AccessDenied names the missing permission.

## Decisions

- **One environment — an SRS deviation, the user's decision (2026-09-30).**
  The SRS lists "Staging and Production environments". Staging was first
  made opt-in (migration `0006` added `users.staging_enabled`), but even
  hidden it confused people, so it was removed from the product: the
  dashboard is production only. The `environment` columns stay and every new
  row is production, so nothing was migrated away. Migration `0008` dropped
  the now-unused flag. Existing staging rows (only the developer's own test
  account had any) are left in the database, invisible in the dashboard; a
  staging API key created before this still authenticates on the API.
- **Setup guide until the first send**, not until "fully configured": an
  environment with history keeps its dashboard, with a "Setup isn't finished"
  notice for anything missing.
- **Route 53 is best effort**: no zone, no permission, or an error just means
  the records are copied by hand; onboarding never fails because of it.
- **No SNS topic policy is set.** Same-account SES configuration-set
  destinations publish without one; this is the first thing to check if
  events don't arrive after deployment.

## Deliberately not in this phase

- **One-click IAM-role (CloudFormation) connect.** Approved as the future
  default, but it needs a hosted template and a public callback, so it comes
  after deployment. Access keys remain.
- Submitting the sandbox-exit request through the API; Cloudflare DNS.
- The deployment itself.

## Honest limits

- `CreateTopic`, `Subscribe`, configuration sets and Route 53 writes are
  tested against mocked SDK clients only. The first real run is the
  post-deployment checklist in `operations/DEPLOYMENT.md`.
- Your stored `TESTSES` credential has only the original four SES
  permissions. Until its policy is replaced, "Connect events" will stop at
  `sns:CreateTopic` with a message saying so, and Route 53 publishing falls
  back to manual.
- Playwright e2e specs were updated but not re-run (they sign in as your
  account); `environment-switcher.spec.ts` was deleted with the switcher.

## Tests

- `tests/integration/events-setup.test.ts` — call order, registration before
  subscribe, idempotency, permission errors, deleted identities, local
  endpoints, another tenant's topic.
- `tests/unit/route53.test.ts` — zone matching (parents, private zones,
  near-miss names), UPSERT batch, denied/failed outcomes.
- `tests/integration/domains.test.ts` — Route 53 and configuration-set hooks
  in onboarding, including failures not blocking it.
- `tests/integration/dashboard.test.ts` — always production (even with a
  staging credential, cookie or crafted form post), one-click key.
- `tests/integration/email-identities.test.ts` — confirmation flow, adoption,
  expiry/deletion, cooldown, tenant isolation, events hook, vercel.app refusal.
- `tests/integration/pages-render.test.ts` — setup guide for a new account,
  dashboard kept after the first send, updated pages.
