# Phase 4 — Product Dashboard & Developer Experience

Status: **code complete**. 484 tests pass, and every page server-renders
against seeded data. Queries were verified on the live Supabase database.
**Not yet looked at in a browser** (see [Verification](#7-verification)).

Source of truth: `docs/Ops-Free_Amazon_SES_Engine_SRS.pdf`, §12 (screens).
Previous phases: [1](PHASE-1.md) · [2](PHASE-2.md) · [3](PHASE-3.md).

---

## 1. Scope → where it lives

| Scope item | Where |
| --- | --- |
| Main dashboard | `/dashboard`: setup checklist, 1/7/30-day stats, reputation vs SES thresholds, volume chart, queue, recent activity, top errors, test send |
| Email activity explorer | `/dashboard/activity`: search, filters, pagination |
| Delivery statistics | `src/server/activity.ts` `deliveryStats`, `volumeSeries`; `VolumeChart` |
| Message detail page | `/dashboard/activity/[id]`: recipients, timeline, identifiers, queue job, error explanation |
| Queue status | overview card, `/dashboard/health` |
| Error tracking | `/dashboard/errors`: failures by cause, bounce types, dead letter; `src/lib/dashboard/error-hints.ts` |
| API key management UI | `/dashboard/api-keys`: create, **rotate with overlap**, revoke, environment scope |
| AWS credential management UI | `/dashboard/aws`: status, region, **quota meter, sandbox state**, re-validate |
| Domain management | `/dashboard/domains`, now environment-scoped |
| Suppression management | `/dashboard/suppressions`: **manual add/remove, audited**, search, pagination |
| Environment switching | sidebar switcher → cookie → `src/server/environment.ts` |
| Search and filtering | activity (text, status, error code, date range), suppressions |
| Pagination | activity, suppressions (`Pagination` in `primitives.tsx`) |
| Responsive layouts | sidebar ≥1024px, top bar + menu below; tables hide secondary columns; forms stack |

**The exit criterion, walked through:** configure (AWS → Domains → Webhooks →
API keys, driven by the overview checklist) → **send** (the test-send form) →
inspect (Activity → message detail) → troubleshoot (Errors, with a fix per code)
→ manage infrastructure (keys, credentials, domains, suppressions, queue).

---

## 2. Decisions worth defending

### 2.1 The dashboard's send is the API's send

The exit criterion says a developer can *send email* through the dashboard. The
test-send form doesn't reimplement anything. The acceptance pipeline
(suppression → durable log → durable enqueue) was extracted from the route into
`src/server/send-service.ts` `acceptSend`, and both `POST /api/v1/send` and the
dashboard call it. The refactor kept all 33 send-route tests passing, unchanged.
A dashboard test is a real send, tagged `source=dashboard-test`, and appears in
Activity like any other.

### 2.2 Environment is a view preference, not a permission

The switcher sets a cookie. It decides *which environment's data a page shows*;
every query is still scoped by the tenant from the verified session. A tampered
cookie value is ignored (tested). With no cookie, the default is the
environment that actually has a credential, so a staging-only user doesn't land
on an empty production dashboard.

Suppressions and webhooks stay tenant-wide, as designed in Phase 3. The pages
say so.

### 2.3 Rotation is not revocation

Revoking a key on rotation turns every rotation into an outage until the new
key is deployed. `rotateApiKey` issues a replacement and gives the old key a
deadline (now / 1 h / 24 h / 7 d) through the existing `expires_at` column,
which authentication already enforces. It never *extends* an earlier deadline.

### 2.4 Manual suppression changes are explicit and auditable (SRS §11)

- **Explicit:** one address per change, a written reason required, and removing
  a hard-bounced or complaining address shows a reputation warning first.
- **Auditable:** the `audit_logs` row (actor, action, address, reason, previous
  state) is written **in the same transaction** as the change. A failed audit
  write rolls the change back (tested).
- **Removal deactivates, never deletes.** The row keeps its original reason and
  source event, and a new hard bounce re-activates it automatically.

### 2.5 Errors are explained, not just listed

`error-hints.ts` maps every code the platform can record (its own codes, plus
every AWS error name the classifier knows) to a plain explanation and the page
that fixes it. A test **derives** the list from the classifier, so an AWS error
added there without an explanation fails the build. Failures are grouped by
cause: fifty messages failing on one missing credential read as one problem.

### 2.6 Rates next to AWS's own thresholds

A bounce rate means little without knowing where AWS acts. The overview shows
bounce (warn 5%, review 10%) and complaint (warn 0.1%, review 0.5%) rates
against SES's enforcement thresholds, with icon + words, never color alone.

---

## 3. A cross-tenant leak, found and fixed

`getQueueHealth` returned the **platform-wide** dead-letter list. Since Phase 2
the Health page showed it to every tenant: other tenants' job ids, log ids and
failure text. SES failure text can quote recipient addresses ("Email address
is not verified: …"). In a multi-tenant deployment that exposes customer PII.

Fixed at the source: `getQueueHealth(userId)` now **requires** the tenant and
filters dead-lettered jobs by the `userId` each job carries, so no caller can
get the unfiltered list by omission. Queue depth and worker heartbeats stay
platform-wide and are labelled that way. A test fails another tenant's job
whose error contains an address and asserts the address appears nowhere in the
result.

---

## 4. The volume chart

Stacked columns, one per day (hourly for 24 h), in four outcome groups. Built
to the dataviz method:

- categorical slots 1–4 in fixed order, **run through the palette validator**
  against this app's white surface. All hard checks pass (worst adjacent CVD
  ΔE 9.1, normal-vision 22.9);
- two slots are under 3:1 contrast, so the required relief ships with it: a
  legend, a hover tooltip per column (the hit target is the whole band), and a
  data table;
- columns capped at 24px, 4px rounded data end, 2px surface gaps between
  segments, 1px recessive gridlines, integer "nice" ticks;
- no dark variant: the app has no dark theme.

---

## 5. Schema

Migration `drizzle/0002_phase4_dashboard.sql`. Purely additive, applied to
Supabase.

| Change | Why |
| --- | --- |
| `audit_logs` | SRS §6 recommended table; required for §11 manual unsuppression |
| `aws_credentials.account_snapshot` (nullable jsonb) | §12 AWS screen: quota and sandbox state without an AWS call per render |
| index `email_logs_user_env_queued` | every explorer and stats query filters tenant + environment and orders by time |

---

## 6. Deliberate scope boundaries

| Not built | Why |
| --- | --- |
| Templates, template filter in Activity | FR-6 is not in this phase's scope. The SRS lists "template" as an Activity filter; there are no templates to filter by. |
| Sandbox-exit assistant (FR-8) | not in scope |
| Dark mode | not in scope; the app has never had a theme toggle |
| Message bodies on the detail page | never stored (SRS §9); the queue job holds them only until delivery |
| Replay / retry of dead-lettered jobs | "queue status" is visibility; a replay tool is an SRS future extension |
| Audit log for keys and credentials | `audit_logs` exists now; only suppression changes are recorded, the one change the SRS requires to be auditable |
| Full-text / trigram search | `ILIKE` over subject, sender, message id and `recipients::text`, served by the tenant+environment index. Fine at this scale; revisit with `pg_trgm` if a tenant reaches millions of rows. |
| Offset pagination at depth | offset + `count(*)`. Cheap within one tenant+environment; keyset pagination is the upgrade if deep pages get slow. |

---

## 7. Verification

**484 tests, 23 files** (Phase 3: 392). New: 92.

| File | Tests | Covers |
| --- | --- | --- |
| `unit/dashboard.test.ts` | 45 | URL state, formatting, error-hint coverage derived from the classifier, AWS thresholds, stats arithmetic |
| `integration/dashboard.test.ts` | 33 | explorer (tenant + env scoping, every search field, LIKE escaping, filters, paging), detail, stats windows, volume buckets, error and bounce grouping, rotation, audited suppression incl. rollback, **dead-letter tenant filter**, credential snapshot, env switching, dashboard test send through the real queue |
| `integration/pages-render.test.ts` | 14 | **every dashboard page server-renders** on seeded data (PostgreSQL + Redis), plus layout and nav |
| `integration/credentials.test.ts` | +4 | specific credential-rejection messages (added between phases) |

**Mutation-checked.** Each of these, broken on purpose, fails the suite:

- the dead-letter tenant filter
- environment scoping on the explorer
- tenant scoping on message detail
- rotation extending an earlier deadline
- trusting the environment cookie blindly
- writing the audit row outside the transaction

The last one is caught broadly: PGlite's single connection breaks too, not only
the rollback assertion.

**Live, on Supabase through postgres-js:** migration 0002 applied; stats,
hourly and daily volume series (`db.execute` returns a different shape than on
PGlite), error and bounce grouping, recipient search with paging, message
detail, audited add/remove, and rotation all pass. The temporary tenant was
removed.

**Responsive layout was audited in the markup, not viewed.** No browser tool
was available this session. The audit found and fixed two issues that would
have caused sideways scrolling on a 320px phone: the SNS topic input had a
288px minimum width, and the chart a 280px floor. What still needs a human look:

- [ ] each page at ~375px and ~1280px wide
- [ ] the mobile menu opens and closes, and the environment switcher works from it
- [ ] chart tooltips on hover, and on tap on touch devices (keyboard focus
      also opens them)

---

## 8. What changed outside the new pages

- `POST /api/v1/send` delegates acceptance to `acceptSend`; behaviour unchanged.
- `getQueueHealth` requires a tenant (the leak fix).
- `revalidateCredential` reports *why* AWS refused, like `storeCredential`.
- `KNOWN_SES_ERROR_NAMES` exported from `src/lib/ses/errors.ts` for the
  hint-coverage test.
- `vitest.config.mts` compiles JSX, for the page-render test.
