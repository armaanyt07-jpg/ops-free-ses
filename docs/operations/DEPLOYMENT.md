# Production deployment

**Status: prepared, not performed.** It needs accounts only you can provide:
Vercel, a container host for the worker, and an Upstash Redis with its
password.

## Topology (SRS §15)

| Piece | Where | Why |
| --- | --- | --- |
| Next.js app (API, dashboard, webhook) | **Vercel**, region closest to the database (Supabase is `ap-south-1` → Vercel `bom1`) | serverless fits request/response; co-location cuts every DB round trip from ~25 ms to ~1 ms |
| Worker | **Railway / Fly.io / Render / ECS** via `Dockerfile.worker`, same region | long-lived process; must not be serverless |
| PostgreSQL | Supabase (existing project) | — |
| Redis | **Upstash**, same region, `rediss://` (TLS) URL | BullMQ needs the Redis protocol, not the REST URL |

## Environment

| Variable | App | Worker | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | — | public by design |
| `DATABASE_URL` | ✓ | ✓ | transaction pooler (6543) |
| `REDIS_URL` | ✓ | ✓ | `rediss://…upstash.io:6379` |
| `ENCRYPTION_KEY` | ✓ | ✓ | the same value on both; back it up separately |
| `ENCRYPTION_KEY_PREVIOUS` | during rotation | during rotation | see BACKUP-RECOVERY |
| `WORKER_CONCURRENCY` | — | optional (5) | the SES rate is enforced separately |
| `RATE_LIMIT_*` | optional | — | defaults in `.env.example` |
| `NEXT_PUBLIC_SENTRY_DSN` | optional | — | error monitoring; plain type, needs a fresh build — see OBSERVABILITY |
| `SENTRY_DSN` | — | optional | the same DSN, for the worker |
| `PUBLIC_APP_URL` | optional | — | Phase 8: base URL "Connect events" subscribes to SNS; defaults to the request host |

## First deployment

1. **Upstash:** create the database in the same region; copy the
   `rediss://` URL (Redis/ioredis tab, not REST).
2. **Preflight against production values:**
   `DATABASE_URL=… REDIS_URL=… ENCRYPTION_KEY=… npm run preflight`. All must
   pass. It confirms the Data API is closed, and that **Upstash allows `TIME`
   inside Lua**: the open risk from Phase 2, which the rate limiter depends on.
3. **Migrations:** `npm run db:migrate` (0000–0005).
4. **Worker:** build `Dockerfile.worker` and deploy with the env above. Set a
   stop grace period of at least 60 s. Run 1+ replicas. **The image has not
   been built yet (no Docker on the dev machine); build it in staging first.**
5. **App:** import the repo into Vercel; set env; pick the region; deploy.
   Vercel sets `x-forwarded-for`, which the per-IP limiter trusts. **Don't
   expose the app directly** without a proxy that overwrites that header.
6. **Verify:**
   - `GET /api/health` → 200, and `/api/health/ready` → `ready`;
   - response headers include `Strict-Transport-Security`;
   - sign up, add the AWS credential, verify a domain, create a key;
   - send to `success@simulator.amazonses.com`;
   - subscribe SNS to `https://<app>/api/v1/webhooks/aws-sns`, then send to
     `bounce@` and `complaint@simulator.amazonses.com` and watch Activity and
     Suppressions.
7. **Re-run** `npm run load-test -- --url https://<app>` with a dedicated
   API key, and record the results in `docs/testing/EVIDENCE.md`.

## Releases

- **Order:** migrations → worker → app. Migrations are additive, so older code
  keeps working against the newer schema. Never ship a migration that drops or
  renames something code still reads.
- **Worker rollout:** SIGTERM drains in-flight jobs. Anything past the grace
  period is recovered by stall detection, so rolling restarts lose nothing.
- **Rollback:** redeploy the previous app/worker build (Vercel keeps
  previous deployments). Migrations aren't rolled back; they're additive.
- **Every release:** `npm test`, `npm run typecheck`, `npm run
  typecheck:worker`, lint, `npm run preflight`. Before large releases:
  `npm run test:resilience`.

## After the first deployment (Phase 8)

"Connect events" and the one-click AWS connection could not be exercised
against real AWS from a laptop (SNS cannot reach localhost). Once deployed:

1. Replace the `TESTSES` IAM user's policy with the one on the AWS page
   (`src/lib/aws/iam-policy.ts`) — it adds the SNS, configuration-set and
   Route 53 actions.
2. Press **Connect events** and confirm: the topic shows **confirmed** on
   Webhooks, and a test send to `bounce@simulator.amazonses.com` appears as
   bounced in Activity.
3. Then build the CloudFormation IAM-role connect (approved, deferred).

## Not yet done

- The deployment itself.
- A CI pipeline running the checks above on every push.
- A log drain / alerting destination (`OBSERVABILITY.md`).
- Enforcing CSP after a browser check (`security/AUDIT.md` F-06).
