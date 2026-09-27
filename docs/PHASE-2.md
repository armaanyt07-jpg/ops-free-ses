# Phase 2 — Queueing, Rate Limiting & Reliability

Status: **code complete**, verified against real Redis + real PostgreSQL.
Live Upstash verification pending (see [Verification](#8-verification)).

Source of truth: `docs/Ops-Free_Amazon_SES_Engine_SRS.pdf` (SRS v1.0).
Phase 1: [`PHASE-1.md`](PHASE-1.md).

---

## 1. What changed

Phase 1 accepted a message, committed a log row, returned 202, then called SES
in a post-response task. Acceptance was durable; **delivery was not**. A restart
between the response and the SES call stranded the row in `queued` forever.

Phase 2 closes that gap. The API now enqueues into Redis *before* responding,
and a separate long-lived worker process performs delivery.

```
  BEFORE (Phase 1)                    AFTER (Phase 2)
  ────────────────                    ───────────────
  POST /send                          POST /send
    ├ commit log row                    ├ commit log row
    ├ 202 ──────────────►               ├ enqueue to Redis  ◄── durable
    └ after(): call SES                 └ 202 ──────────────►
       ⚠ lost on restart
                                      worker process (separate)
                                        ├ acquire rate token
                                        ├ decrypt credential
                                        ├ call SES
                                        └ retry / dead-letter
```

| Phase 2 objective | Where it lives |
| --- | --- |
| Upstash Redis | `src/lib/queue/connection.ts` |
| BullMQ | `src/lib/queue/send-queue.ts` |
| Persistent queue architecture | `src/server/dispatch.ts` (producer), `worker/` (consumer) |
| Worker process | `worker/index.ts`, `worker/processor.ts` |
| Distributed rate limiter | `src/lib/queue/rate-limiter.ts` |
| SES MaxSendRate handling | `aws_credentials.ses_max_send_rate` → token bucket |
| Configurable worker concurrency | `WORKER_CONCURRENCY` |
| Exponential backoff | `src/lib/queue/retry-policy.ts` |
| Retry classification | `src/lib/ses/errors.ts` (from Phase 1) |
| Dead-letter/failure handling | BullMQ failed set + `providerEvent.terminalReason` |
| Idempotency keys | DB unique index + BullMQ `jobId` |
| Job correlation IDs | `requestId` carried into `SendJobData` |
| Queue monitoring | `src/server/queue-health.ts`, `/dashboard/health` |
| Worker health monitoring | `worker/heartbeat.ts` |

---

## 2. Three design decisions worth defending

### 2.1 The rate limiter is ours, not BullMQ's

BullMQ ships a worker-level limiter (`limiter: { max, duration }`). It is not
used here, because it is **global to the queue**: one tenant on a 1/sec SES
sandbox quota would throttle every other tenant's jobs on the same worker.

Instead, `src/lib/queue/rate-limiter.ts` is a token bucket in Redis keyed by
`(tenant, environment)`, sized from the tenant's own
`aws_credentials.ses_max_send_rate` — the value AWS `GetAccount` reported and
Phase 1 already stored.

Two details that carry the guarantee:

- **It is a Lua script.** Check-and-consume is atomic. A read-then-write from
  the client would let two workers observe the same token and both spend it —
  precisely the race the limiter exists to prevent.
- **The clock comes from Redis `TIME`, not the worker.** Workers on different
  machines have skewed clocks, and refill computed against a skewed clock
  silently grants more tokens than the rate allows.

When no rate is known, it falls back to the SES sandbox default of **1/sec**,
never to "unlimited". Guessing high would mean deliberately exceeding a
provider limit, which SRS FR-4 forbids.

### 2.2 Being rate limited is not a failed attempt

When a job cannot get a token it is re-delayed via `job.moveToDelayed()` and
the processor throws `DelayedError`, which BullMQ understands as *deliberately
deferred*. **The attempt counter is untouched.**

If deferral consumed a retry, a tenant on a low SES quota would exhaust its
retries purely by waiting its turn, and lose mail it was never permitted to
send yet. Test: *"defers without consuming a retry attempt"*.

### 2.3 The failed set *is* the dead-letter queue

A second DLQ queue was considered and rejected. It would duplicate state that
BullMQ already keeps, and the two copies would drift.

So dead-lettering is: the job lands in BullMQ's failed set (retained 14 days),
and the email log is closed out with `providerEvent.terminalReason` naming
why. Both halves are visible on `/dashboard/health`.

```
terminalReason: "permanent"           SES rejected it outright — no retry
                "attempts_exhausted"  retryable, but ran out of attempts
                "no_credential"       nothing configured for that environment
```

---

## 3. Retry semantics

Policy in `src/lib/queue/retry-policy.ts`, per SRS §8 ("5–8 attempts,
exponential delay with jitter, capped around 15–30 minutes"):

| Setting | Value |
| --- | --- |
| Attempts | 6 |
| Base delay | 5s |
| Growth | exponential, ×2 per attempt |
| Cap | 20 minutes |
| Jitter | **full** — uniform in `[base, exponential]` |

Full jitter rather than the exponential value itself: without it, a
provider-wide throttle makes every queued job retry at the same instant and
re-trigger the throttle. That is the thundering herd the jitter exists to
break up.

Classification is inherited unchanged from Phase 1's `classifySesError`, so
the retry decision and the error surfaced to the customer cannot disagree.

| Condition | Behaviour | Log status between attempts |
| --- | --- | --- |
| Throttling / 5xx / transport | retry with backoff | stays `queued` |
| Permanent SES rejection | `UnrecoverableError`, stops at once | `failed` |
| No credential configured | stops at once | `failed` |
| Undecryptable credential | stops at once | `failed` |
| Attempts exhausted | dead-letter | `failed` |

**The log stays `queued` between retries, not `failed`.** The message is still
live; marking it failed while the queue is about to retry would misreport the
system's state. `completedAt` stays null until the lifecycle actually closes.

---

## 4. Durability

This is the exit criterion with the most ways to get it wrong.

1. **The 202 means the job exists.** `enqueueSend` runs inside the request,
   before the response. If Redis will not take the job the caller gets
   **503 QUEUE_UNAVAILABLE** — never a 202 for a message that was never queued.
2. **An orphaned log row is closed out.** If the enqueue fails after the row is
   committed, the row is marked `failed` rather than stranded in `queued` with
   nothing to drive it.
3. **A dead worker's job is recovered.** BullMQ's stalled-job detection
   (`lockDuration: 60s`, `stalledInterval: 30s`, `maxStalledCount: 2`) returns
   an abandoned job to `wait` for another worker. Tested by killing a worker
   mid-SES-call and asserting a second worker completes the message.
4. **Shutdown drains.** `SIGTERM`/`SIGINT` call `worker.close()`, which stops
   intake and waits for in-flight jobs, so a deploy does not abandon a job
   mid-call.

### A bug this phase found

The producer connection originally inherited `maxRetriesPerRequest: null`,
which BullMQ *requires* on connections holding blocking reads. On the
**producer** it meant "retry this command forever" — so with Redis unreachable,
`queue.add()` never returned and **the API hung instead of answering 503**.

Fixed in `connectionOptions(role)`: the producer gets bounded retries, and
`enqueueSend` additionally races a 5s ceiling, so an HTTP request terminates
predictably whatever Redis is doing. The "queue unavailable" tests went from
timing out at 20s to passing in milliseconds.

---

## 5. Idempotency, in two layers

| Layer | Mechanism | Stops |
| --- | --- | --- |
| Database | unique index `(user_id, idempotency_key)` | two accepted requests |
| Queue | `jobId = log-<logId>` | two jobs for one accepted request |

BullMQ treats `jobId` as a uniqueness key, so even a double enqueue cannot
produce a second delivery.

> Note: BullMQ rejects a custom job id containing `:` — it uses that character
> as its own Redis key separator. The id uses a hyphen. This was caught by the
> route test, having silently broken every enqueue.

---

## 6. Running it

Phase 2 needs **two processes**. The web app alone will accept sends and never
deliver them.

```bash
npm run dev      # terminal 1 — API + dashboard
npm run worker   # terminal 2 — delivery worker
```

`/dashboard/health` says so explicitly when no worker is reporting.

| Script | Purpose |
| --- | --- |
| `npm run worker` | Start a delivery worker |
| `npm run worker:dev` | Same, restarting on change |
| `npm run typecheck:worker` | Typecheck the worker against its own tsconfig |

### Why the worker has its own tsconfig

Modules like `@/server/credentials` import `server-only`, which throws outside
a React Server Component — that is what makes it a useful guard for the Next.js
bundle. The worker is a standalone Node process, so `tsconfig.worker.json`
maps `server-only` to an empty shim. **The guard still applies with full force
to the Next.js build**; only the worker's tsconfig relaxes it.

### Deployment

SRS §15: *"long-lived BullMQ workers should not be treated as ordinary Vercel
serverless request handlers."* The Next.js app deploys to Vercel; the worker
needs a persistent runtime (Railway, Fly, Render, ECS). Scale it horizontally
— the rate limiter is distributed, so N workers still respect each tenant's
SES quota.

---

## 7. Testing

**204 tests, 14 files** (Phase 1: 174). New in Phase 2: 33.

Integration tests run against a **real `redis-server`** on a random port, with
persistence disabled and its own temp dir, torn down afterwards. Nothing about
the queue is mocked: BullMQ ships Lua scripts and depends on blocking reads and
atomic semantics, and the rate limiter is itself a Lua script whose whole point
is atomicity. A fake would verify nothing that matters.

Only AWS is mocked, at the SES client boundary.

| File | Tests | Covers |
| --- | --- | --- |
| `unit/retry-policy.test.ts` | 9 | backoff bounds, jitter spread, SRS ranges |
| `integration/rate-limiter.test.ts` | 14 | burst, refill, tenant isolation, atomicity |
| `integration/worker.test.ts` | 10 | delivery, retry, dead-letter, stall recovery |
| `integration/send-route.test.ts` | 26 | rewritten for enqueue-before-202 |

Singled out:

- **Atomicity across connections** — 8 separate Redis clients race for 6
  tokens; exactly 6 are granted. A read-then-write limiter fails this.
- **Rate limiting does not consume attempts** — two jobs at 1/sec both deliver,
  and neither burns a retry on waiting.
- **Stalled-job recovery** — a worker is killed mid-SES-call; a second worker
  picks the job up and completes it. This is the exit criterion.
- **Permanent failure stops at once** — SES is called once, not five times,
  when it permanently rejects.

---

## 8. Verification

Verified locally:

- [x] `npm test` — 204 passing
- [x] `npm run typecheck` and `typecheck:worker` — clean under strict
- [x] `npx eslint src tests worker` — clean
- [x] `npx next build` — succeeds, `/dashboard/health` present
- [x] Worker boots, resolves the `server-only` shim, loads `.env.local`

Verified end-to-end against a **local Redis + the live Supabase project**
(production build, `next start`):

- [x] Worker boots, registers a heartbeat, and is visible in Redis
- [x] `POST /api/v1/send` → 202 → worker picks the job up unaided
- [x] Terminal state recorded correctly (`NO_ACTIVE_CREDENTIAL`,
      `terminalReason: "no_credential"`) — the right outcome with no AWS
      credential configured
- [x] 35/35 jobs drained to a terminal state under load
- [x] Correlation id threads HTTP header → job → worker log:
      `requestId=phase2-trace-1` appears on the worker's own log lines
- [x] Job ids are `log-<uuid>`, one per accepted message

### Measured ingestion latency

Production build, 30 warm requests, laptop → Supabase ap-south-1:

| | |
| --- | --- |
| median | **114 ms** |
| min | 107 ms |
| p95 | 268 ms |

> **Correction (Phase 3):** the breakdown below undercounts the network. With
> `prepare: false`, postgres-js makes **two** round trips per parameterized
> query (Describe, then Execute), so the two queries cost ≈104 ms, not ≈52 ms.
> Measured and explained in [`PHASE-3.md` §10](PHASE-3.md#10-latency--and-a-correction-to-phase-2).

**This does not meet the SRS §5 <100 ms target in this setup, and it is not
the queue's fault.** Measured breakdown:

- BullMQ enqueue: **0–1 ms** (40-sample median against local Redis)
- Supabase round trip: **26 ms**, and the path makes **two sequential** queries
  — authenticate the API key, then insert the log row — so ~52 ms is network
- the remainder is Next.js request overhead on this machine

The two queries cannot be parallelised: the log insert needs the tenant id the
auth query returns. Co-locating the app with the database (Vercel in
ap-south-1) would collapse the 52 ms to single digits, but **that is inference,
not a measurement** — the target should be re-measured in a deployed
environment before it is claimed as met.

### Queue backend: local Redis for now

Development runs against a local Redis (`brew services start redis`,
`REDIS_URL=redis://127.0.0.1:6379`), verified end to end:

- [x] `TIME` inside the limiter's Lua script is accepted (Redis 8.10.2)
- [x] Rate limiter enforces exactly `rate` grants per burst against real Redis
- [x] 202 → worker → terminal state, unattended
- [x] Idempotency replay returns 409; one job per accepted message
- [x] Burst of 25 accepted in 451 ms; **27/27** drained, none lost
- [x] Queue returns to empty (waiting/active/delayed all 0)
- [x] Permanent failures stop at **attempts=1**, not 6 — visible on the
      dead-letter list
- [x] Worker heartbeat healthy and readable by `/dashboard/health`

Upstash remains the deployment target (SRS §15) and is **not yet verified**.
Its endpoint was confirmed live — TCP 6379 open, valid TLS 1.3, answering
`NOAUTH` — but the Redis-protocol password has not been supplied, so:

- [ ] Worker connects to Upstash over `rediss://`
- [ ] `TIME` is permitted inside a Lua script **on Upstash specifically**
      (it works on stock Redis; managed providers sometimes restrict
      non-deterministic commands in scripts)
- [ ] Enqueue latency across a real network hop — the 0–1 ms figure below is a
      *local* number and will not hold against a remote Redis

> Note: the Upstash REST URL (`https://…upstash.io`) cannot be used. BullMQ
> ships Lua scripts and relies on blocking reads; neither works over REST.
> `redisUrl()` rejects an `https://` value up front with that explanation.

**Risk to check first:** the rate limiter calls `redis.call('TIME')` inside its
Lua script. Some managed Redis providers disallow non-deterministic commands in
scripts. If Upstash rejects it, the fix is to pass the timestamp from the
client and accept a small clock-skew tolerance — a contained change to one
file, but it must be confirmed against the real service, not assumed.

---

## 9. Exit criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| API ingestion is asynchronous | Met | Route enqueues; SES never called in-request |
| API responds after durable queue acceptance | Met | *"has committed the log and enqueued the job before responding"* |
| Worker processes jobs independently | Met | Separate process; `worker.test.ts` |
| SES rate limits are respected | Met | 14 limiter tests incl. atomicity |
| Retryable failures automatically retry | Met | *"retries throttling and succeeds on a later attempt"* |
| Permanent failures terminate correctly | Met | *"stops immediately without consuming remaining attempts"* |
| Duplicate requests handled via idempotency | Met | DB index + `jobId`; 409 on replay |
| Worker failure does not silently lose jobs | Met | *"recovers a job abandoned by a dead worker"* |

All eight are evidenced against real Redis. What remains is confirming the
same behaviour against Upstash specifically.

---

## 10. What Phase 3 inherits

- `SendJobData.requestId` — correlation id already threaded end to end.
- `suppression_list` — still empty, and the pre-send check is still absent;
  FR-5 adds both, and the worker's processor is where the second check belongs
  (SRS §11: "immediately before provider submission").
- `/dashboard/health` — has a slot for webhook lag once SNS ingestion exists.
- Dead-letter entries — carry enough context for a replay tool.
