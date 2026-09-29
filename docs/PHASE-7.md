# Phase 7 — Production Hardening

Status: **complete, except production deployment**, which is prepared but
needs your Vercel, worker-host and Upstash accounts. The exit criterion
(documented evidence that security, reliability, recovery and performance
were tested) is met in [`testing/EVIDENCE.md`](testing/EVIDENCE.md).

## The headline

The audit found a **critical, live vulnerability that had existed since
Phase 1**. Supabase's Data API gave the public anon key full read and write
access to every table, so anyone could have inserted an API key for any
tenant and sent mail through their AWS account. It was **fixed and verified
live** during this phase, and is now guarded by a test and by the pre-deploy
check. Details: [`security/AUDIT.md`](security/AUDIT.md) F-01.

## Scope → where it lives

| Scope item | Deliverable |
| --- | --- |
| Security audit | [`security/AUDIT.md`](security/AUDIT.md): 13 findings; 12 fixed, 1 accepted with reasoning |
| Tenant-isolation testing | `tests/integration/tenant-isolation.test.ts` (every tenant-scoped function, all 12 tables proven unchanged) |
| Credential-security review | AUDIT "Reviewed and sound"; master-key rotation (F-07); `credential-security.test.ts` (no secret in logs or responses) |
| API abuse protection | `src/server/abuse.ts`: per-IP (before DB), per-key, per-tenant limits, 429 + `Retry-After`, fail-open; 2 MB body cap; webhook amplification closed |
| Load testing | `npm run load-test`; results in EVIDENCE §Performance |
| Queue stress testing | `tests/resilience/queue-and-workers.test.ts` |
| Worker failure testing | same file: workers killed mid-delivery; DB failure after send |
| Redis failure testing | `tests/resilience/redis-failure.test.ts`: SIGKILL + AOF restart; outage mid-delivery |
| Database recovery testing | `tests/resilience/database-recovery.test.ts`: outages at each layer, reconciliation, backup/restore drill |
| Webhook replay testing | `tests/resilience/webhook-replay.test.ts`: 200 seeded orderings, replay after restore, concurrent replay |
| Observability | [`operations/OBSERVABILITY.md`](operations/OBSERVABILITY.md): health endpoints, event catalogue, alerts |
| Error monitoring | `src/lib/observability/errors.ts`, `src/instrumentation.ts`, API error boundary, worker handlers |
| Structured logging | `security.*` events for sensitive dashboard changes; existing allow-listed logger |
| Production deployment | [`operations/DEPLOYMENT.md`](operations/DEPLOYMENT.md), `Dockerfile.worker`, `npm run preflight`; **not performed** |
| Backup/recovery procedures | [`operations/BACKUP-RECOVERY.md`](operations/BACKUP-RECOVERY.md), `npm run reconcile`, `npm run rotate:encryption-key` |
| Incident runbook | [`operations/RUNBOOK.md`](operations/RUNBOOK.md) |
| Architecture documentation | [`ARCHITECTURE.md`](ARCHITECTURE.md) |

## Fixes made along the way (not only tests)

| Fix | Why it mattered |
| --- | --- |
| Data API locked down (migration `0005`) | F-01, critical |
| Rate limits, body cap, security headers, sign-out CSRF | F-02, F-03, F-06, F-10 |
| Dead-letter list scoped to the tenant | F-04: other tenants' recipient addresses were visible |
| No re-send after SES accepted (`acceptedBySes`) | F-08: a DB error after a successful send used to send the email again |
| Error boundary on API routes | F-09: bare 500s with no envelope or request id |
| Master-key keyring and rotation | F-07 |
| Certificate negative cache, **definitive failures only** | F-05, without dropping genuine events on transient blips (SNS retries for only about a minute) |
| Stranded-message reconciliation | recovery after queue data loss |
| Portable error fingerprint | the production build caught a `node:crypto` import reaching the edge runtime |

## Honest limits

- **Performance:** correct under load (1,500/1,500, 0 lost), but about 27
  req/s per instance and p50 172 ms from this laptop. The SRS <100 ms target
  isn't met in this setup; the database-round-trip levers are listed in
  EVIDENCE.
- **At-least-once at SES:** a crash in the milliseconds between SES answering
  and the acceptance record reaching Redis can duplicate a send. Bounded,
  documented, 0 in every test run.
- **Not yet evidenced:** a real SES send, a genuine SNS event, the deployment,
  the Docker image, Upstash specifically, an enforced CSP. Each has a stated
  way to close it (EVIDENCE, last section).

## Numbers

**637 tests** in the main suite (Phase 6: 586) + **13 resilience tests**
(`npm run test:resilience`), + preflight (11 checks) and the load test.
Migration `0005` applied to Supabase. New scripts: `preflight`, `load-test`,
`reconcile`, `rotate:encryption-key`, `test:resilience`.
