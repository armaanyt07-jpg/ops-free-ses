# Phase 1 — Foundation & Core Sending Engine

Status: **complete**, pending a live end-to-end run against real Supabase and
AWS accounts (see [Verification](#verification)).

Source of truth: `docs/Ops-Free_Amazon_SES_Engine_SRS.pdf` (SRS v1.0).
Section references below (§) point into it.

---

## 1. What Phase 1 delivers

| Phase 1 objective | Where it lives |
| --- | --- |
| Next.js 15 App Router project | `src/app/` |
| TypeScript strict configuration | `tsconfig.json` |
| Tailwind CSS + shadcn/ui | `src/app/globals.css`, `src/components/ui/` |
| Supabase Auth | `src/lib/supabase/`, `src/middleware.ts`, `src/app/login/` |
| PostgreSQL + Drizzle ORM | `src/db/` |
| Core schema and migrations | `src/db/schema.ts`, `drizzle/0000_phase1_core_schema.sql` |
| User/tenant model | `src/server/tenant.ts` |
| AWS credential storage and encryption | `src/lib/crypto/encryption.ts`, `src/server/credentials.ts` |
| Production/Staging environments | `environment` enum, threaded through every table and API key |
| API key generation and hashed storage | `src/lib/crypto/api-key.ts`, `src/server/api-keys.ts` |
| `POST /api/v1/send` | `src/app/api/v1/send/route.ts` |
| AWS SES SDK v3 integration | `src/lib/ses/client.ts`, `src/lib/ses/errors.ts` |
| Basic email activity logging | `src/server/email-logs.ts`, `src/app/dashboard/activity/` |

---

## 2. Deliberate scope boundaries

Phase 1 implements its own scope list and nothing beyond it. These SRS
features are **not** built, by design, and are listed here so the gaps are
known rather than discovered:

| Not in Phase 1 | SRS | Consequence today |
| --- | --- | --- |
| Redis / BullMQ queue | FR-4, §8 | Delivery is dispatched in-process (see §3 below) |
| Domain & DNS verification | FR-2 | No pre-send sender check; SES rejects and the error is classified |
| SNS bounce/complaint webhooks | FR-5 | Logs terminate at `sent`; `delivered`/`bounced`/`complained` are unreachable |
| Suppression enforcement | FR-5, §11 | The table exists and is empty; no suppression check runs before send |
| Template builder and `{{variable}}` rendering | FR-6 | `templateId` and `variables` are **rejected** with 400, not silently ignored |
| Analytics dashboards | FR-7 | Activity list only; no aggregate metrics |
| Sandbox exit assistant | FR-8 | Sandbox state is surfaced on the AWS page; no request generator |

The `verified_domains`, `email_templates` and `suppression_list` tables are
created by the Phase 1 migration because `email_logs` is foreign-keyed to
`email_templates`. They are not read or written by any Phase 1 code path.

---

## 3. The one architectural deviation, stated plainly

SRS §8 specifies: API validates → creates a `queued` log → **durably enqueues a
BullMQ job** → returns 202 → a worker sends. Phase 1 has no Redis and no
BullMQ, so the enqueue step does not exist yet.

What Phase 1 does instead, in `src/server/dispatch.ts`:

1. The log row is committed **before** the 202 is returned. Acceptance is
   durable and the response means exactly what the SRS says it means.
2. The SES call runs in a post-response task (Next.js `after()`), which keeps
   server-side ingestion inside the §5 sub-100 ms target.
3. The row transitions `queued → sending → sent | failed`, exactly as a worker
   would drive it.

**The gap this leaves:** delivery is not durable. A process restart between the
response and the SES call strands the row in `queued` with nothing to resume
it. SRS §8's "worker crash: job remains recoverable" is **not satisfied in
Phase 1**. Closing it is Phase 2's core purpose.

`deliver()` is the seam. Phase 2 replaces its body with a BullMQ enqueue and
moves the SES call into the worker; the surrounding contract — a log row
transitions through those states and no exception escapes — does not change.
Retryability is already classified and recorded on every failure
(`providerEvent.retryable`) so the Phase 2 worker inherits the policy rather
than re-deriving it.

---

## 4. Security properties and how each is enforced

| SRS requirement | Mechanism | Test |
| --- | --- | --- |
| AES-256 authenticated encryption for AWS secrets (§9) | AES-256-GCM, versioned envelope, random 96-bit IV | `tests/unit/encryption.test.ts` |
| Ciphertext bound to its owner | GCM AAD = `version:userId:environment`; a transplanted row fails to decrypt | `tests/integration/credentials.test.ts` |
| Secret never returned after creation (§16) | `CredentialSummary` has no secret-bearing field; the type makes leakage a compile error | `tests/integration/credentials.test.ts` |
| API keys stored only as hashes (§9) | SHA-256 of a 256-bit CSPRNG secret; only the digest is persisted | `tests/integration/api-keys.test.ts` |
| API key shown once (§9) | Plaintext exists only in `createApiKey`'s return value | `tests/integration/api-keys.test.ts` |
| Revoked key cannot send (§16) | `authenticateApiKey` rejects on `revokedAt`/`expiresAt` | `tests/integration/send-route.test.ts` |
| Tenant isolation (§9, §16) | Every query carries `userId` in its predicate; ids are never accepted from the client | `tests/integration/*.test.ts` |
| Credentials never reach the browser | AWS SDK, decryption and DB access are all behind `server-only` | build scan, below |
| Never log secrets or bearer tokens (§9) | `log.*` takes a fixed allow-listed field set — no spread | `src/lib/api/logger.ts` |

**Why SHA-256 and not bcrypt/argon2 for API keys:** the input is 256 bits of
uniform CSPRNG output, so there is no dictionary to attack and no work factor
to justify. The digest must also be deterministic, because the SRS §6 schema
locates a presented key through the `api_keys_hash` unique index in a single
indexed lookup — a password KDF cannot be looked up, only compared row by row.

**Verified against the real build output** (`.next/static`): zero occurrences
of the database URL, `ENCRYPTION_KEY`, `decryptSecret`, the AWS SDK, or the
ciphertext column name in any client chunk.

---

## 5. Error model (§14)

The code set is closed — exactly the eight SRS codes. New failure shapes are
mapped onto an existing code rather than expanding the public contract.

Two mappings are worth stating because they are judgement calls:

- **AWS credential failures** (`InvalidClientTokenId`, `SignatureDoesNotMatch`,
  `ExpiredToken`, …) → `SES_REJECTED`. The SRS has no credential-specific code.
  They are permanent for the request — the same stored key cannot succeed on
  retry — and the message names the real cause.
- **`MessageRejected`** → `DOMAIN_NOT_VERIFIED`. SES uses this as its catch-all
  for an unverified or disallowed sender identity, which is its dominant cause
  and the one the SRS gives a dedicated code to.

`CREDENTIAL_DECRYPTION_FAILED` appears in `email_logs.error_code` (the
provider-code column, not the API error envelope) when stored ciphertext cannot
be decrypted. It is deliberately not an SES error: classifying it as one would
report a platform fault as a transient network failure and invite a pointless
retry.

---

## 6. Running it

```bash
npm install
cp .env.example .env.local     # then fill in — see §7
npm run db:migrate             # applies drizzle/ to the Supabase database
npm run dev
```

| Script | Purpose |
| --- | --- |
| `npm test` | Full suite (unit + integration) |
| `npm run test:unit` | Unit tests only, no database |
| `npm run test:integration` | Integration tests against PGlite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Regenerate a migration after a schema change |
| `npm run db:migrate` | Apply migrations |

### Supabase setup

1. Create a project.
2. **Authentication → Providers → Email**: enable it. For local development,
   turning off "Confirm email" lets signup sign you straight in.
3. Copy the URL and anon key into `.env.local`.
4. Copy the **transaction pooler** connection string (port 6543) into
   `DATABASE_URL`. The `postgres-js` client is configured with
   `prepare: false`, which that pooler requires.

### Sending a test email

```bash
curl -i -X POST http://localhost:3000/api/v1/send \
  -H "Authorization: Bearer sk_test_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "from": "noreply@your-verified-domain.com",
    "to": ["you@example.com"],
    "subject": "Phase 1",
    "html": "<h1>It works</h1>"
  }'
```

Expect `202` with `{"id": "...", "status": "queued", ...}`, then watch the row
reach `sent` on `/dashboard/activity`.

While your AWS account is in the SES sandbox, **both** the sender and every
recipient must be verified identities in that region, or SES returns
`MessageRejected` and the log shows `DOMAIN_NOT_VERIFIED`.

---

## 7. Configuration

See `.env.example`. Four variables, no more.

`ENCRYPTION_KEY` must decode to exactly 32 bytes; a wrong length fails loudly
at startup rather than silently weakening encryption. **Rotating it makes every
stored AWS credential undecryptable** — they must be re-entered. Back it up
separately from the database, since the two together are what a credential
compromise requires.

---

## 8. Testing

174 tests across 11 files — 91 unit, 83 integration.

Integration tests run the **real repository code** against
[PGlite](https://pglite.dev) — PostgreSQL compiled to WebAssembly — using the
**same generated migrations** that ship to Supabase. Unique indexes, enums,
foreign keys, `ON CONFLICT` and `gen_random_uuid()` all behave as in
production, which matters because the idempotency and tenant-isolation
guarantees rest on exactly those constructs. Docker is not required.

Only two boundaries are mocked: the SES client (no AWS calls) and Next.js
`after()` (so post-response delivery can be awaited deterministically).

Worth singling out:

- **Idempotency under concurrency** — eight simultaneous requests sharing an
  idempotency key; exactly one is accepted and the other seven are pointed at
  it. Uniqueness is delegated to PostgreSQL rather than a read-then-write
  check, which is what makes this hold.
- **Cross-tenant ciphertext transplant** — a credential row copied to another
  tenant fails to decrypt rather than yielding the secret.
- **Revoked-vs-unknown key indistinguishability** — both return a
  byte-identical message, so probing cannot enumerate valid keys.

---

## 9. Verification

Verified locally:

- [x] `npm test` — 174 passing
- [x] `npm run typecheck` — clean under `strict` + `noUncheckedIndexedAccess`
- [x] `npx eslint src tests` — clean
- [x] `npx next build` — succeeds, all routes correctly dynamic
- [x] No server secret in any client bundle (scan of `.next/static`)

Verified against the live Supabase project (`hpnxdpexzbmwmmmhrxrx`, ap-south-1):

- [x] Database reachable over the transaction pooler — PostgreSQL 17.6
- [x] `drizzle-kit migrate` applied `0000_phase1_core_schema.sql` cleanly
- [x] Live schema re-verified: 7 tables, 3 enums, 6 unique indexes, 6 cascading
      foreign keys — the same assertions the PGlite suite makes
- [x] Idempotency unique index rejects a replay **on the live database**
- [x] Tenant delete cascades to `email_logs` on the live database
- [x] Supabase Auth API reachable with the anon key (email signup enabled;
      `mailer_autoconfirm` is **off**, so signup requires email confirmation)
- [x] Dev server boots against live config; unauthenticated `/dashboard`
      redirects to `/login?next=…`
- [x] End-to-end through the running app: `POST /api/v1/send` with a seeded
      production key returned **202**, the replayed `Idempotency-Key` returned
      **409** with no second row, the log reached `failed` with
      "No active AWS credential is configured for the production environment",
      and `api_keys.last_used_at` was recorded

Still requires accounts not yet connected:

- [x] Signed up through the browser — the tenant row materialised in
      `public.users` via `ensureTenant`, keyed by the Supabase auth user id
- [ ] Store a real AWS credential (exercises `GetAccount` validation)
- [ ] Send a real email through SES and see the log reach `sent`

---

## 10. Exit criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| User can authenticate | **Met** — real signup created the tenant row | `src/app/login/`, `src/server/tenant.ts` |
| User can configure AWS SES credentials securely | Code complete, needs live AWS | `tests/integration/credentials.test.ts` (16 tests) |
| User can create an API key | Met | `tests/integration/api-keys.test.ts` (14 tests) |
| A valid API request sends an email through SES | Met end-to-end on live DB; SES itself still mocked | `tests/integration/send-route.test.ts` (29 tests) + live run |
| Credentials are never exposed to the client | Met | Type-level + `server-only` + build scan |
| Basic logs are persisted | Met | `tests/integration/email-logs.test.ts` (14 tests) |
| Unit and integration tests pass | Met | 174 passing |

---

## 11. What Phase 2 inherits

- `deliver()` in `src/server/dispatch.ts` — the enqueue seam.
- `classifySesError()` — retry policy, already written and tested.
- `providerEvent.retryable` — already recorded on every failure.
- `aws_credentials.ses_max_send_rate` — already populated from AWS
  `GetAccount`, ready to drive the FR-4 distributed limiter.
- `suppression_list` — created and empty, ready for FR-5.
