# Evidence — Phase 7 exit criterion

> "The system must have documented evidence that critical security,
> reliability, recovery, and performance requirements have been tested."

Every number here comes from runs made on 2026-09-27. Re-run to reproduce:

```bash
npm test                  # 637 tests — unit, integration, security guards
npm run test:resilience   # 13 tests — stress, chaos, outages, recovery, replay
npm run load-test -- --url <server>   # load against a running production build
npm run preflight         # deployment checks against the target environment
```

Measurements are written to `test-results/resilience.jsonl` and
`test-results/load.json`.

**Test environment:** real Redis (`redis-server` 8.x), real BullMQ, the real
worker processor, real PostgreSQL semantics (PGlite in tests; live Supabase
for load and live checks). SES is simulated in tests. **Nothing here has
reached real AWS SES** — see "Not yet evidenced" at the end.

---

## Security

| Requirement | Evidence | Result |
| --- | --- | --- |
| Security audit | `docs/security/AUDIT.md`: 13 findings, 12 fixed, 1 accepted with reasoning | F-01 critical found **and fixed live** |
| Data API closed (F-01) | live probe with the public anon key, before and after; `migrations.test.ts` RLS guard; `preflight` | before: 200 on all tables incl. writes · after: `42501 permission denied`, 0 grants, RLS 12/12 |
| Tenant isolation (SRS §16) | `tenant-isolation.test.ts` (10): tenant B calls every tenant-scoped function with A's ids | all reads empty, all writes refused, **all 12 of A's tables byte-identical** afterwards |
| Credential security | `credential-security.test.ts` (4) | master key rotated with 0 loss; **no secret in any log line or response** across credential, key and send flows, including failures |
| API abuse protection | `abuse.test.ts` (11) | 429 + `Retry-After` per key and per IP; IP limit applies before DB work; fails open when Redis is down; 2 MB body cap (declared and streamed); test sends limited per tenant |
| Static guards | `security-static.test.ts` (23) | every Server Action authenticates; every route has a named mechanism; no server code or secret reaches the client; no raw HTML/eval |
| Webhook authenticity | Phase 3 suites + negative-cache tests | forged, re-signed and unregistered-topic messages refused; definitive cert failures cached, transient never |
| Security headers | `abuse.test.ts`; verified over HTTP on a production build | `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy, HSTS (prod), CSP (report-only), no `X-Powered-By` |

**Mutation-tested:** the security properties were each broken on purpose and
the suite caught every one: dead-letter tenant filter, environment and tenant
scoping, the audit transaction, rotation deadlines, cookie trust, template
escaping, header injection, unknown variables, archived templates, signature
and topic checks, webhook dedupe, the fabrication guards (Phases 3–6).

---

## Reliability

| Test | Scenario | Result |
| --- | --- | --- |
| Queue stress | 2,000 messages, 4 tenants, 3 workers × 10 concurrency | **478 msg/s**, **0 lost, 0 duplicates**; worst per-tenant 1-second window **199** against a limit of 200 (rate 100 + burst 100) |
| Worker failure | 600 messages; workers killed mid-delivery every 400 ms (in-flight SES calls never return, as in a dead process) | 5 workers killed, **0 lost, 0 duplicates** |
| DB failure after send | 300 messages; 30% of post-send DB writes fail | **0 re-sends** (F-08 fix; without it the suite fails) |
| Redis crash | 300 queued jobs; `redis-server` SIGKILLed, restarted on the same data (AOF, `appendfsync always`) | **300/300 delivered, 0 duplicates** |
| Redis outage mid-delivery | 400 messages; Redis down 2 s after 51 were sent | workers reconnected; **400/400 delivered, 0 lost, 0 duplicates** |
| Worker crash (Phase 2) | abandoned job recovered by stall detection | pass |

---

## Recovery

| Test | Scenario | Result |
| --- | --- | --- |
| DB down at authentication | the API-key lookup throws | 500 with the SRS error envelope + request id; one structured, fingerprinted error report (F-09) |
| DB down while persisting | log insert fails | 503, **nothing enqueued**; no 202 for an unrecorded message |
| DB down in the worker | 3 attempts fail, then the DB returns | retried, then **sent exactly once** |
| Queue data loss | logs whose jobs vanished | `npm run reconcile` closes the 2 stranded messages honestly ("not sent" vs "may have reached SES"); leaves live and recent ones alone; idempotent |
| Backup and restore drill | logical backup → data deleted → restore into a fresh engine | 52 rows restored; RLS and unique constraints intact |
| Webhook replay: order | 200 random orderings of a message's events, with random duplicates (seeded) | **0 divergent**: all converge to the same statuses and suppressions |
| Webhook replay: after restore | events wiped as if restored from a backup, then replayed twice | identical final state |
| Webhook replay: concurrent | one genuinely signed message delivered 25× at once | applied **once**, 24 ignored |
| Master key rotation | encrypt → switch key → rotate → retire the old key | 0 credentials lost; rows no key can decrypt are reported, not skipped |

---

## Performance

Load test: production build, one app instance on a laptop, live Supabase
(ap-south-1), local Redis, one worker. Rate limits raised for the run to
measure capacity.

| Concurrency | Requests | Throughput | p50 | p95 | p99 | max | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 500 | 5 req/s | 172 ms | 235 ms | 504 ms | 737 ms | 500 × 202 |
| 10 | 500 | 25 req/s | 276 ms | 982 ms | 1,433 ms | 2,042 ms | 500 × 202 |
| 25 | 500 | 27 req/s | 737 ms | 2,238 ms | 2,987 ms | 3,344 ms | 500 × 202 |

Drain: **1,500 accepted → 1,500 terminal, 0 lost, 0 errors.**

**Read this honestly:**

- **Correctness under load is proven; the SRS §5 latency target (<100 ms) is
  not met in this setup.** Throughput plateaus at about 27 req/s per instance
  because each send makes 3 parameterized database queries, and with
  `prepare: false` each costs 2 round trips (~51 ms) from this laptop to
  Supabase, through a 10-connection pool. Network round trips to the database
  are the bottleneck, not the application (`docs/PHASE-3.md` §10).
- **Levers, not yet pulled:** the `prepare` / pooler decision; running the
  app in the database's region (round trips drop from ~25 ms to ~1 ms); more
  app instances (queue and limiter are already distributed).
- **Re-measure in the deployed environment** before claiming any latency
  figure.

The worker side is not the bottleneck: 478 msg/s in the queue stress test.

> [!WARNING]
> **Correction (2026-10-02).** That figure was measured against a local
> database and Redis. In production the worker's database round trips are the
> bottleneck for *latency*: each send takes about **5 seconds** from `queued`
> to `sent`. See [`PHASE-3.md` §10.1](../PHASE-3.md#101-production-finding-2026-10-02-every-send-takes-about-5-seconds).

---

## Observability

| Requirement | Evidence |
| --- | --- |
| Structured logging | allow-listed JSON lines with request id, tenant, environment, job id, status, latency; `security.*` events for every sensitive dashboard change |
| Error monitoring | `error.unhandled` events, fingerprinted and redacted, from routes, pages, Server Actions (`instrumentation.ts`) and the worker |
| Health | `/api/health` (liveness) and `/api/health/ready` (DB + Redis; 503 when degraded), verified over HTTP |
| Queue and worker health | `/dashboard/health`: depth, dead letter (tenant-scoped), heartbeats, webhook lag |

---

## Not yet evidenced (and why)

| Gap | Blocker | How to close |
| --- | --- | --- |
| A real email through SES | no verified sender identity | verify one address in SES; send to the mailbox simulator |
| Genuine AWS-signed SNS event | no public endpoint | deploy (or tunnel) and follow Webhooks setup |
| Production deployment | needs your Vercel, worker-host and Upstash accounts | `docs/operations/DEPLOYMENT.md` |
| Worker container image | Docker isn't installed on the build machine | build `Dockerfile.worker` once in staging |
| Upstash specifically | the password was never provided | `npm run preflight` against it checks reachability and Lua `TIME` |
| Enforced CSP | needs a browser pass | AUDIT F-06 |
| Latency target | environment-dependent | re-run `npm run load-test` after deploying |
