# Phase 3 — Domain Verification & Event Processing

Status: **code complete**, verified against real PostgreSQL (Supabase), real
DNS and real Redis. **Not yet verified against AWS** — no AWS credential exists
in this environment, so no SES identity has been created and no genuine SNS
message has been received (see [Verification](#9-verification)).

Source of truth: `docs/Ops-Free_Amazon_SES_Engine_SRS.pdf` (SRS v1.0).
Previous phases: [`PHASE-1.md`](PHASE-1.md), [`PHASE-2.md`](PHASE-2.md).

---

## 1. What changed

Phase 2 ended every message at `sent`. SES knew what happened next; this
platform did not. Phase 3 closes the loop in both directions:

```
  BEFORE SENDING                         AFTER SENDING
  ──────────────                         ─────────────
  Dashboard → Domains                    SES ──► SNS ──► POST /api/v1/webhooks/aws-sns
    ├ CreateEmailIdentity (Easy DKIM)                        ├ verify signature
    ├ show DKIM / SPF / DMARC records                        ├ match topic → tenant
    ├ check SES + resolve DNS ourselves                      ├ dedupe on MessageId   ┐
    └ worker polls until verified                            ├ update email_logs     │ one
                                                             └ upsert suppression    ┘ transaction
  POST /send ── suppressed? ──► 403
  worker     ── suppressed? ──► not sent            SES is never called for a suppressed address
```

| Phase 3 scope item | Where it lives |
| --- | --- |
| Domain onboarding | `src/server/domains.ts` `onboardDomain`, `/dashboard/domains` |
| SES identity verification | `src/lib/ses/client.ts` (`createDomainIdentity`, `getDomainIdentity`) |
| SPF / DKIM / DMARC verification | `src/lib/dns/checks.ts` (pure), `src/lib/dns/resolver.ts` (lookups) |
| DNS status checking | `checkDomain`, `GET /api/v1/domains/verify`, `worker/domain-processor.ts` |
| AWS SNS integration | `src/app/api/v1/webhooks/aws-sns/route.ts`, `src/server/sns-topics.ts`, `/dashboard/webhooks` |
| SNS signature verification | `src/lib/sns/verify.ts`, `message.ts`, `certificate.ts` |
| Bounce / complaint / delivery processing | `src/lib/ses/notification.ts`, `delivery-state.ts`, `src/server/sns-events.ts` |
| Suppression list | `src/server/suppression.ts`, `/dashboard/suppressions` |
| Automatic suppression enforcement | `src/app/api/v1/send/route.ts`, `worker/processor.ts` |
| Webhook idempotency | `sns_events_message_id` unique index + single transaction |

---

## 2. Decisions worth defending

### 2.1 The topic ARN identifies the tenant

SRS §7 fixes a single webhook path for everyone, so something in the message
has to say whose it is. That is the **SNS topic ARN**, which each tenant
registers on the Webhooks page (`sns_topics`, unique on `topic_arn`).

A valid signature proves a message came *from SNS*. It does not prove it came
from *this tenant's SES*: anyone can create a topic, subscribe our public URL
to it, and publish a perfectly signed fake hard bounce. So:

- a message from an unregistered topic is refused with 403, **after** the
  signature check (the order SRS §7 gives, and one that doesn't reveal which
  topics are registered to an unauthenticated caller);
- a `SubscriptionConfirmation` from an unregistered topic is **never
  confirmed**. The endpoint cannot be enrolled in a topic nobody here owns;
- a topic belongs to exactly one tenant. If two could register it, one could
  suppress the other's recipients.

The tenant id used for every write comes from the topic row, never from the
payload.

### 2.2 One transaction is the idempotency guarantee

`processNotification` does four things in one transaction: insert the event
(keyed on SNS `MessageId`), update the log, upsert suppressions, and stamp the
topic. The insert goes first and uses `ON CONFLICT DO NOTHING`. If it conflicts,
the function returns before anything else runs.

So "this event was recorded" and "this event's effects were applied" cannot
disagree. If any step fails, everything rolls back, the webhook answers 5xx,
SNS redelivers, and the redelivery starts clean. That case is tested by
renaming the suppression table mid-flight: the event row is gone afterwards,
and the retry applies once.

### 2.3 SES is the only authority on `verified`

`verified_domains.status` is `verified` exactly when SES reports the identity
as verified for sending. SPF and DMARC are checked and reported, but they don't
gate verification: SES doesn't require them, and if our status did, the
dashboard would call a domain unverified while SES happily sent from it.

DKIM is checked by us *and* by SES, and the two can disagree for a while
(propagation). Our check says *which* record is wrong; SES's says whether it has
noticed yet.

### 2.4 A message with a suppressed recipient is refused whole

If any recipient is suppressed, the API returns **403 `RECIPIENT_SUPPRESSED`**
listing the suppressed addresses, writes no log, and enqueues nothing. It
doesn't quietly send to the rest: every recipient sees the To list, so a subset
would be a different message from the one the caller asked for.

Following SRS §8's order (check suppression, *then* create the log), a refused
request does not consume its idempotency key. The caller can remove the address
and retry with the same key.

The worker checks again before calling SES, because a bounce can land while a
job waits (SRS §11: "immediately before provider submission"). A message caught
there gets the terminal status `suppressed` and the job *completes*. Nothing
failed, so it must not retry or dead-letter.

### 2.5 An event can beat the worker's `markSent`

SES returns a message id, the worker writes it to the log, and only then can
the webhook match events to that log. SNS delivery normally takes seconds, but
nothing prevents an event from arriving in the gap. Then:

1. the webhook stores the event unmatched (`log_id` null);
2. right after `markSent`, the worker calls `reconcileEventsForLog`, which
   applies any unmatched events for that SES message id.

Two transactions racing need a lock, or one interleaving still loses the event.
Both paths take `pg_advisory_xact_lock(hashtextextended(ses_message_id, 0))`,
so one always sees the other's committed write.

Reconciliation is outside the worker's send `try` and can't throw. SES has
already accepted the message, and an error escaping there would make BullMQ
retry the job and **send the email twice**.

---

## 3. Domains

### Onboarding (SRS §10 steps 1–3)

1. Normalise the input to a bare domain. URLs, email addresses, IPs and
   single labels are refused before any AWS call.
2. `CreateEmailIdentity` with Easy DKIM, in the tenant's own account and in the
   region of that environment's credential. `AlreadyExistsException` means the
   identity was started elsewhere (e.g. the SES console) and it is **adopted**,
   not treated as an error.
3. Store the DKIM tokens and the region, then check immediately so the user sees
   real DNS state, not an empty checklist.
4. If still pending, arm background polling.

Records shown to publish:

| Purpose | Type | Name | Value |
| --- | --- | --- | --- |
| DKIM ×3 | CNAME | `<token>._domainkey.<domain>` | `<token>.dkim.amazonses.com` |
| SPF | TXT | `<domain>` | `v=spf1 include:amazonses.com ~all` |
| DMARC | TXT | `_dmarc.<domain>` | `v=DMARC1; p=none;` |

### What the checks detect (SRS §10: "where technically observable")

| Check | Detects |
| --- | --- |
| DKIM | missing CNAME; **wrong token** (points at another `…dkim.amazonses.com`); record published at the doubled name `x._domainkey.example.com.example.com` |
| SPF | missing; **duplicate records** (RFC 7208 permerror, so SPF fails for everything); SES not included; `+all` / bare `all` |
| DMARC | missing; multiple records (RFC 7489: all ignored); `v=DMARC1` not first; missing or invalid `p=`; doubled name |
| All | a lookup that **failed** (timeout, SERVFAIL) is reported `unknown`, never `fail` |

The doubled-name probe covers the most common real-world mistake: a DNS
provider that appends the zone to whatever you type. It only runs when the
correct name is empty, so a healthy domain costs no extra lookups.

### Status mapping

| SES says | `status` | Notes |
| --- | --- | --- |
| verified for sending | `verified` | |
| `FAILED` | `failed` | SES gave up (72 h). Restart it in the SES console. |
| identity not found | `failed` | Deleted in AWS. |
| anything else | `pending` | `PENDING`, `NOT_STARTED`, `TEMPORARY_FAILURE` |
| SES unreachable / no credential / region moved | *unchanged* | Reported as `unavailable`. We don't know, so we don't guess. |

**Region is stored per domain** (`verified_domains.aws_region`). SES identities
are regional, and a credential can be rotated to a different region. Without
this, the next check would ask the wrong region, get `NotFound`, and mark a
healthy domain failed.

### Polling (FR-2 "bounded retries", §18 "bounded polling")

A `domain-verification` BullMQ queue, consumed by a second Worker in the
existing worker process. The processor throws while the domain is pending, and
BullMQ's own retry does the scheduling:

- first look after 1 minute, then doubling (2, 4, 8, … min) to a 2-hour ceiling;
- 20 attempts ≈ 28 hours, inside SES's 72-hour window;
- when attempts run out, the domain stays `pending` with an accurate
  last-checked time, and **Check now** arms a new round;
- the job id is `domain-<id>`, so re-arming mid-round never doubles up.

It runs server-side, so verification advances with nobody on the dashboard.

### Rate limit on verification (SRS §9)

Both **Check now** and `GET /api/v1/domains/verify` return the stored result if
it is under 30 seconds old. Hammering either costs at most one SES call and a
handful of DNS lookups per domain per 30 seconds.

### `GET /api/v1/domains/verify`

API-key authenticated. The key's environment is the default and the only one it
may read (400 otherwise). A domain that was never added answers **403
`DOMAIN_NOT_VERIFIED`**. The response is the SRS §7 shape, with `problems`,
`found` and `records` added so a CI script can say *what* is wrong.

---

## 4. The webhook

`POST /api/v1/webhooks/aws-sns`. SNS posts JSON with `Content-Type: text/plain`,
so the body is read as text and parsed. The content type is not trusted.

### Signature verification

1. **Certificate URL checked before fetching:** HTTPS,
   `sns.<region>.amazonaws.com` (or `.com.cn`), port 443, no userinfo, `.pem`.
   Lookalikes such as `sns.us-east-1.amazonaws.com.evil.com` are tested.
2. Fetched with `redirect: "error"`, a 5 s timeout and a 16 KB cap, parsed as
   X.509, and cached per URL.
3. Validity window checked.
4. RSA verify: SHA-1 for `SignatureVersion` 1 (the SNS default), SHA-256 for 2,
   over the canonical string (fixed key order; `Subject` omitted entirely when
   absent).

The `SubscribeURL` gets the same host check before the server fetches it. It
comes from a request body, and must never be steerable at an internal address.

**Raw message delivery must be off.** It strips the envelope that carries the
signature; such a request gets a 400 that says so.

### Responses

| Status | When | SNS then |
| --- | --- | --- |
| 200 | processed, duplicate, subscription confirmed, unsubscribed | done |
| 400 | not JSON, not an SNS envelope | — |
| 401 | signature invalid, certificate expired, untrusted certificate URL | — |
| 403 | valid signature, topic not registered | — |
| 413 | body over 512 KB | — |
| **500** | processing failed (transaction rolled back) | retries |
| **503** | signing certificate could not be **fetched** | retries |

The 503 row exists because of a live finding. A transient failure to fetch the
certificate was first answered 401, as if the message were forged. That failure
is ours, not the sender's, and a 4xx risks SNS treating a genuine bounce as
permanently undeliverable. A forged message gains nothing from the 503: it still
isn't acted on.

`UnsubscribeConfirmation` is recorded and the topic marked `unsubscribed`, but
it is deliberately not re-subscribed. Someone chose that in the AWS console.

---

## 5. Events and state

Both SES publishing routes are accepted and normalised: identity feedback
notifications (`notificationType`) and configuration-set events (`eventType`).

### One log, many recipients

A log row covers up to 50 recipients; SES reports outcomes per recipient. Each
recipient's outcome goes into `provider_event.recipients`, and the row's
`status` is the **most severe** outcome across them. One complaint is never
hidden behind 49 deliveries. `completed_at` is set once every recipient has an
outcome.

### Order is not guaranteed

Outcomes only move forward by severity: `delivered < bounced < complained`. A
delivery arriving after a complaint changes nothing. A complaint after a
delivery upgrades that recipient.

### Suppression policy (SRS §11: "policy-driven")

`src/lib/ses/suppression-policy.ts`. The tests pin these values:

| Event | Suppress? | Why |
| --- | --- | --- |
| Permanent bounce (incl. `OnAccountSuppressionList`) | **yes** — `hard_bounce` | the mailbox will never accept mail |
| Complaint | **yes** — `complaint` | the recipient marked it as spam |
| Transient bounce | no | mailbox full etc.; SES already retried |
| Undetermined bounce | no | suppression isn't undone automatically, so be conservative |

- **Per tenant, not per environment.** An address that hard-bounced from
  staging doesn't exist in production either.
- **Lowercased.** Otherwise `Bob@x.com` would get through after `bob@x.com`
  bounced.
- An already-active suppression **keeps its first reason and source event**. A
  deactivated one is re-activated by fresh evidence.
- An event for mail this platform didn't send (same SES identity, used from
  elsewhere) is stored unmatched, **and still suppresses**. A hard bounce is a
  hard bounce.

### What is stored

`sns_events.payload` is a bounded projection: bounce type/subtype, recipients,
diagnostic code (≤500 chars), feedback ids, processing time. No subject, no
headers, no sender (SRS §9, §11). A test posts an event containing a secret
subject line and asserts it never reaches the database.

---

## 6. Schema

Migration `drizzle/0001_phase3_domains_events.sql`. **Purely additive:** no
baseline column renamed, retyped or dropped.

| Change | Why |
| --- | --- |
| `sns_events` (unique `message_id`) | SRS §6 "recommended additional production tables"; the idempotency key |
| `sns_topics` (unique `topic_arn`) | the "expected topic" of FR-5 step 2 needs something to be checked against |
| `verified_domains.aws_region` (nullable) | identities are regional; see §3 |
| `verified_domains.check_result` (nullable jsonb) | the dashboard renders stored state instead of doing DNS + AWS calls per page view |

The two nullable columns are the only departure from the SRS §6 table
definitions, and they are stated here so the departure is known.
`verified_domains.spf_record` / `dmarc_record` hold the *expected* values.
`ses_identity_arn` stays null: SESv2 doesn't return it, and deriving it would
need an STS call for the account id.

---

## 7. Customer setup

On the Webhooks page, in this order:

1. In the AWS account and region of the SES identity, create a **standard** SNS
   topic. SES can't publish to FIFO.
2. **Register the topic ARN first.** A subscription request from an unregistered
   topic is refused.
3. Create an **HTTPS** subscription to the endpoint shown on the page. Leave raw
   message delivery off. It is confirmed automatically.
4. In SES → identity → Notifications, point Bounce, Complaint and Delivery
   feedback at the topic. A configuration-set event destination also works.

The endpoint must be publicly reachable over HTTPS. `localhost` can't receive
SNS, and the page warns when it is being viewed there.

---

## 8. Deliberate scope boundaries

Not built, by design. Listed so they are known rather than discovered.

| Not built | SRS | Why / consequence |
| --- | --- | --- |
| Refusing `/send` from an unverified sender domain | §7 "403 sender/domain not authorized" | Not in the Phase 3 scope list. SES itself rejects unverified senders, and the worker already classifies that as `DOMAIN_NOT_VERIFIED`. Enforcing it pre-send would also break tenants who verified addresses directly in SES. A small change when wanted. |
| Custom MAIL FROM domain | §10 SPF "aligned" | SPF is checked on the root domain. Without a custom MAIL FROM, SPF aligns to `amazonses.com`, not the tenant's domain, so **DMARC passes through DKIM alignment**. True SPF alignment needs `PutEmailIdentityMailFromAttributes` plus an MX and a TXT record. |
| "Test sending identity" | §10 step 7 | The test-send workflow belongs to templates (FR-6, Phase 4). |
| Auto-creating the SNS topic and SES notification wiring | — | Would need `sns:*` and SES notification permissions on the customer's key, beyond the least-privilege IAM the platform asks for today. Manual steps are on the Webhooks page. |
| Manual unsuppression | §11 | "Must be explicit and auditable." There is no `audit_logs` table yet, so the Suppressions page is read-only. |
| Rate limiting the webhook | §9 | A forged message costs one bounded, cached certificate fetch and nothing else: no database work happens before verification. Volumetric abuse belongs at the edge (Vercel / WAF). |
| Webhook replay / reconciliation tool | §17, §18 | Listed by the SRS as a future extension. |
| Deleting the SES identity on removal | — | Deliberate. Other systems may send through it, and deleting things in the customer's AWS account is not a side effect this dashboard should have. |

---

## 9. Verification

### Tests

**388 tests, 20 files** (Phase 2: 204). 184 new.

| File | Tests | Covers |
| --- | --- | --- |
| `unit/dns-checks.test.ts` | 36 | every SRS §10 detection, against exact record strings |
| `unit/sns-verify.test.ts` | 37 | canonical string (checked by hand against the AWS doc), host allow-list, tampering of every signed field, v1/v2, wrong key, expiry |
| `unit/sns-certificate.test.ts` | 9 | outbound fetches refuse untrusted hosts and redirects |
| `unit/ses-events.test.ts` | 26 | parsing both formats, redaction round trip, severity ordering, policy, poll schedule |
| `integration/sns-webhook.test.ts` | 29 | the route end to end: forgery, unknown topics, confirmation, every event type, idempotency, rollback, tenant isolation, the markSent race, webhook lag |
| `integration/domains.test.ts` | 34 | onboarding, adoption, status mapping, region drift, cooldown, isolation, the verify API contract, **real BullMQ polling** until verified and until attempts run out |
| `integration/send-route.test.ts` | +7 | 403 before any log or job; case-insensitive; idempotency key not consumed |
| `integration/worker.test.ts` | +3 | suppressed after acceptance → SES never called, job completes; reconcile after send |
| `integration/migrations.test.ts` | +3 | new tables, both unique indexes, nullable columns |

Signing uses a **real RSA key and X.509 certificate** made by `openssl`, so the
verifier runs its production path. Only the HTTPS fetch is substituted.

**Mutation-checked.** Each guarantee was broken on purpose and the suite caught
it: skipping the signature check, skipping the topic check, removing the
duplicate early-return, removing `ON CONFLICT`, and dropping the tenant filter
from the log lookup.

A Phase 2 test-ordering bug surfaced and was fixed: the "queue unavailable"
block left the send-queue singleton bound to a dead port, so any test after it
got 503. No test ran after it until now.

### Live, against Supabase + real DNS + local Redis

- [x] Migration applied to Supabase (2 migrations recorded)
- [x] Event pipeline through **postgres-js on real PostgreSQL**: advisory lock,
      `FOR UPDATE`, jsonb, dedupe, suppression, redaction, the race-reconcile
      path, and the `percentile_cont … FILTER` lag query
- [x] Real DNS: `github.com` SPF correctly **fails** (it doesn't authorize SES);
      DMARC policies parsed; NXDOMAIN returned as an answer, not an error
- [x] Production build over HTTP: junk → 400; forged → 401; untrusted cert URL →
      401 with **no fetch**; unauthenticated verify → 401; new dashboard pages
      redirect to login
- [x] A **real AWS SNS certificate** was fetched, parsed and correctly rejected
      as expired (it lapsed June 2026)
- [x] `/send` with a suppressed recipient → 403, no log row; clean recipient →
      202 → worker → terminal state
- [x] Worker boots consuming both `ses-send` and `domain-verification`
- [x] All temporary tenants removed; the live database is left clean

### Verified against real AWS (2026-10-01 and 2026-10-02)

Run against the deployed app (www.opsfree.in) and the owner's AWS account
(`ap-south-1`, SES sandbox), read back from the production database:

- [x] **Real SNS subscription confirmed.** "Connect events" created the topic
      `ops-free-ses-events`; the webhook accepted the genuine
      `SubscriptionConfirmation` (2026-10-01).
- [x] **Genuine AWS-signed messages verify end to end.** The signature path,
      which had only been checked against AWS's documentation and an expired
      certificate, accepted real Delivery, Bounce and Complaint notifications.
- [x] **Real bounce / complaint / delivery processing**, via the mailbox
      simulator (`bounce@`, `complaint@`, `success@simulator.amazonses.com`):
      each event linked to its `email_logs` row and moved its status.
- [x] **SES sends events to the published HTTPS endpoint.**
- [x] **`CreateEmailIdentity` / `GetEmailIdentity` against real SES**, for
      both email identities (2026-09-30) and the domain `opsfree.in`
      (2026-10-02: DKIM 3 of 3, SPF and DMARC passing, status verified).
- [x] **Sending from the verified domain.** `hello@opsfree.in` to
      `success@simulator.amazonses.com`: queued, sent, delivered, with the
      Delivery event linked to the log row (2026-10-02).

Not yet verified: Route 53 DNS publishing (the owner's DNS is at GoDaddy, so
the records were added by hand) and sending to an arbitrary recipient (the
account is still in the SES sandbox).

**One property is argued, not tested:** the advisory lock closing the
webhook-vs-`markSent` interleaving (§2.5). PGlite is a single connection, so two
truly concurrent transactions can't interleave there. The race is tested in
sequence; the lock is what makes the concurrent case equivalent.

---

## 10. Latency — and a correction to Phase 2

The API-side suppression check adds a database query to the send path. Measured
A/B on the same machine and build, 30 warm requests each:

| | median | p95 |
| --- | --- | --- |
| without the check | 113 ms | 120 ms |
| with the check | 164 ms | 170 ms |

**+51 ms: two round trips, not one.** The cause affects every query in the
application, not just this one:

`src/db/index.ts` sets `prepare: false` (required for Supabase's transaction
pooler). In that mode postgres-js sends **Describe** for every parameterized
query and waits for the reply before Bind/Execute:

```js
// node_modules/postgres/cjs/src/connection.js
q.describeFirst = q.onlyDescribe || (parameters.length && !q.prepared)
```

Measured directly: `select 1` (no parameters) = 25 ms; any parameterized Drizzle
select = 51 ms.

**This corrects `PHASE-2.md` §8**, which attributed the 114 ms median to "two
sequential queries ≈ 52 ms of network, the remainder Next.js overhead". It is
two queries × two round trips ≈ 104 ms. Almost all of the latency is network,
and co-locating with the database helps more than that document estimated.

Whether to change it is a Phase 1 configuration decision with operational
trade-offs, so it is **not changed here**. The options:

- the Supabase session-mode pooler or a direct connection, with prepared
  statements enabled, which avoids the extra round trip after the first
  execution on each connection;
- or leave it and co-locate, where each round trip is ~1 ms.

Either way, re-measure in the deployed environment before claiming the SRS §5
<100 ms target.

### 10.1 Production finding (2026-10-02): every send takes about 5 seconds

> [!NOTE]
> **Resolved (2026-10-02): about 5 s → about 1.4 s.** The cause was geography:
> the worker was on Railway **US West** while Supabase and Upstash are in
> Mumbai, so every database and Redis hop cost ~250 ms (a parameterized query
> is two hops). The worker DB keepalive removed the ~1.6 s reconnect (5.2 s →
> 3.6 s), and moving the worker to Railway **Southeast Asia (Singapore)**, the
> nearest Railway region to Mumbai, brought a send to 1.45 s
> (`wait=85 credential=278 suppression=155 limiter=78 marking=163 ses=563
> record=212` ms). The text below records the original investigation; it said
> the worker was in Singapore, which it was not. Remaining ideas (cache the
> decrypted credential, prepared statements for the worker) would save
> well under half a second and are not worth doing now.

**Measured** on the deployed system (Vercel `bom1`, worker on Railway
US West (not Singapore, as first assumed), Supabase `ap-south-1`), from `sent_at - queued_at` in `email_logs`:

| Sent (UTC) | queued → sent |
| --- | --- |
| 10-01 11:33 | 4.89 s |
| 10-01 11:40 | 5.29 s |
| 10-01 12:06 | 4.80 s |
| 10-01 12:07 | 4.82 s |
| 10-01 12:17 | 5.02 s |
| 10-02 06:04 | 4.89 s |
| 10-02 06:15 | 5.04 s |

The one fast send (0.7 s, 09-30) ran with the worker on a laptop next to the
database.

**Where the time goes.** The worker's `worker.sent` log line now carries a
per-step breakdown (commit `1c17324`). One production send, 5215 ms inside the
worker:

| Step | Time |
| --- | --- |
| Waiting in Redis for the worker | 132 ms |
| Load the AWS credential (one DB query) | **2160 ms** |
| Suppression re-check (one DB query) | **537 ms** |
| Limiter, mark sending, the SES call, record the result | ~2500 ms combined (the log viewer truncated the split) |

The queue is not the problem. The cost is the worker's database round trips
across the network, plus opening a connection.

**Ruled out:** retries (`error_code` is null on every row, and a first retry
waits exactly 5000 ms, which is a coincidence worth knowing about); the rate
limiter (waits ≤ ~1 s in the sandbox); the idle-worker tuning in `b68335e`
(a send after it still took 4.89 s).

**Likely cause (an inference, not yet confirmed by an A/B test):**

1. `src/db/index.ts` closes idle connections after `idle_timeout: 20` s, which
   suits serverless. The worker's sends are minutes apart, so each one starts
   by opening a new connection (TCP, TLS, login). The credential query costs
   ~1.6 s more than the suppression query, which matches.
2. `prepare: false` (§10 above) makes every query two round trips. At the
   worker's distance from the database that is ~540 ms per query, not 51 ms.
3. About eight queries per send add up.

**Fixes, cheapest first** (none shipped):

1. Keep one worker connection warm with a cheap query every ~10 s (worker
   only; leave the web app's setting). Expected ~5 s → ~3 s.
2. Cache the decrypted credential in the worker for a minute or two. Needs care
   around key rotation and credential changes.
3. Prepared statements for the worker via Supabase's session pooler (port
   5432). This is the open `prepare` decision from §10.
4. Verify where the Railway worker and the Upstash Redis actually run; ~270 ms
   per round trip is more than Singapore to Mumbai should cost.

To confirm the cause cheaply: send two emails a few seconds apart. If the
second is much faster than 5 s, the cold connection is the main cost.

Do not quote the SRS §5 latency target as met for end-to-end delivery. §5
speaks about ingestion; this is the background hand-off to SES.

---

## 11. Exit criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| User can onboard a domain through the dashboard | Met* | `/dashboard/domains`; *"creates the SES identity and returns the records to publish"* |
| DNS requirements are clearly displayed | Met | records table with name/value, provider-appends-domain and merge-your-SPF guidance |
| Verification state is accurately reported | Met* | SES is the authority; failed lookups are `unknown`, not `fail`; region drift detected; polling |
| SNS events are authenticated | Met* | 37 verify tests, forgery tests on the route, live rejection of forged messages |
| Bounce and complaint events update email status | Met | *"hard bounce: marks the log bounced and suppresses the address"*; live on Supabase |
| Suppressed addresses cannot be sent to | Met | 403 before log/enqueue; worker re-check with SES never called; live 403 |
| Duplicate webhook events are safely ignored | Met | unique index + one transaction; sequential, concurrent and rollback tests; live |

\* Met in code and tests against mocked AWS. Confirming each against a real AWS
account is the open item in §9.

---

## 12. What Phase 4 inherits

- `sns_events` with `event_at` and `received_at`, ready for 1/7/30-day delivery,
  bounce and complaint metrics (FR-7).
- Per-recipient outcomes in `email_logs.provider_event.recipients`.
- The `suppressed` status, now reachable, for the analytics "Suppressed" count.
- Suppression data for the sandbox-exit assistant's "bounce/complaint controls"
  section (FR-8), from real numbers rather than assertions.
- An `audit_logs` table, if it arrives, unblocks manual unsuppression.
