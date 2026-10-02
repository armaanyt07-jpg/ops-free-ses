# Ops-Free Amazon SES Engine & Dashboard Wrapper

A managed developer platform wrapping Amazon SES: a Resend-style API and
dashboard over **customer-owned** SES credentials, so delivery stays in the
customer's AWS account.

Specification: `docs/Ops-Free_Amazon_SES_Engine_SRS.pdf` (SRS v1.0) — the
source of truth for scope, schema and API contracts.

## Status

Built in phases; each is completed, tested and documented before the next
starts.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation & core sending engine | **Complete** — see [`docs/PHASE-1.md`](docs/PHASE-1.md) |
| 2 | Redis/BullMQ queue, rate limiting, retries | **Complete** — see [`docs/PHASE-2.md`](docs/PHASE-2.md) |
| 3 | Domains, SNS webhooks, suppression | **Complete** — see [`docs/PHASE-3.md`](docs/PHASE-3.md). Verified against real AWS 2026-10-01/02 (SNS, signed webhooks, DKIM domain, events) |
| 4 | Product dashboard & developer experience | **Code complete** — see [`docs/PHASE-4.md`](docs/PHASE-4.md). Browser check at phone width pending |
| 5 | Template system | **Code complete** — see [`docs/PHASE-5.md`](docs/PHASE-5.md). Browser check pending |
| 6 | AWS sandbox exit assistant | **Code complete** — see [`docs/PHASE-6.md`](docs/PHASE-6.md). Browser check pending |
| 7 | Production hardening | **Complete** — see [`docs/PHASE-7.md`](docs/PHASE-7.md). Evidence: [`docs/testing/EVIDENCE.md`](docs/testing/EVIDENCE.md) |
| 8 | Guided onboarding & setup automation | **Complete** — see [`docs/PHASE-8.md`](docs/PHASE-8.md). Deployed at www.opsfree.in; Route 53 automation untested |
| 9 | Sandbox and "waiting for AWS" experience | **Code complete** — see [`docs/PHASE-9.md`](docs/PHASE-9.md). Not yet seen signed in on the live dashboard |

> [!WARNING]
> **Known issue: sends take about 5 seconds from `queued` to `sent` in production.**
> The API answers `202` as soon as the job is queued, so callers aren't blocked,
> and no mail is lost; the delay is the worker's database round trips. Deferred until there are real users. Cause,
> measurements and fix options: [`docs/PHASE-3.md` §10.1](docs/PHASE-3.md#101-production-finding-2026-10-02-every-send-takes-about-5-seconds).

## Documentation

| | |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | components, trust boundaries, a message's life, decisions |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | dashboard tokens, shared components, semantic color, the SRS §20 design gate |
| [`docs/security/AUDIT.md`](docs/security/AUDIT.md) | security audit findings and guards |
| [`docs/testing/EVIDENCE.md`](docs/testing/EVIDENCE.md) | what has been tested, with measurements |
| [`docs/operations/`](docs/operations/) | deployment, observability, runbook, backup and recovery |

## Stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui ·
Supabase Auth · PostgreSQL + Drizzle ORM · Upstash Redis + BullMQ ·
AWS SDK v3 (SESv2) · Vitest + PGlite

## Quick start

```bash
npm install
cp .env.example .env.local   # Supabase + Upstash + a generated ENCRYPTION_KEY
npm run db:migrate

brew services start redis   # queue backend for development

npm run dev       # terminal 1 — API + dashboard
npm run worker    # terminal 2 — delivery worker
```

Both processes are required. The app alone accepts sends and never delivers
them; `/dashboard/health` says so when no worker is reporting. The worker also
polls domain verification in the background.

SES bounce/complaint/delivery events arrive at `POST /api/v1/webhooks/aws-sns`,
which must be reachable over public HTTPS — SNS cannot post to localhost. Setup
steps are on the dashboard's Webhooks page.

Full setup, architecture notes and scope boundaries: [`docs/PHASE-1.md`](docs/PHASE-1.md).

## Layout

```
src/
  app/
    api/v1/send/        POST /api/v1/send
    api/v1/webhooks/    POST /api/v1/webhooks/aws-sns
    api/v1/domains/     GET  /api/v1/domains/verify
    dashboard/          Overview, Activity (+ message detail), Errors,
                        Templates (editor, versions, test send), Domains,
                        Production access (sandbox-exit assistant), Suppressions, Webhooks, API keys, AWS,
                        Queue & health (one environment; the first visit is a setup guide)
    login/ signup/      Supabase Auth
  db/                   Drizzle schema (SRS §6) and client
  lib/
    crypto/             AES-256-GCM vault, API key generation
    ses/                AWS SDK v3 client, error classification, event
                        parsing, delivery state, suppression policy
    sns/                Envelope parsing and signature verification
    dns/                SPF/DKIM/DMARC lookups and analysis
    templates/          {{variable}} engine: validate, render, plain-text fallback
    sandbox/            production-access request generator (no fabrication by construction)
    api/                Error model, request IDs, validation, logging
    supabase/           Server client and session middleware
    queue/              Redis connection, BullMQ queue, rate limiter, retry policy
  server/               Tenant, environment, credentials, API keys, logs,
                        send-service (shared by API + dashboard), dispatch,
                        activity/stats, queue health, domains, SNS, suppression
worker/                 Standalone BullMQ worker: delivery + domain polling
drizzle/                Versioned SQL migrations
tests/                  Unit + integration (PGlite + real redis-server)
```

## Tests

```bash
npm test                  # 637 tests
npm run test:resilience   # 13 stress / chaos / outage / replay tests
npm run preflight         # pre-deploy checks against the target environment
npm run typecheck
npm run typecheck:worker
```

Integration tests run the real repositories and the real migrations against
PostgreSQL-in-WASM, and the real queue against a throwaway `redis-server`. No
Docker, no AWS calls, no hosted database or Redis required.

Requires `redis-server` and `openssl` on PATH (`brew install redis`; openssl
ships with macOS). SNS signature tests sign with a real certificate made by
openssl.
