# Security audit — Phase 7

Date: 2026-09-27. Scope: the whole application (Phases 1–6), its database, and
its dependencies. Method: live probing of the deployed Supabase project with
public credentials only, a line-by-line review of every public entry point, and
automated tests that encode each fix so it can't regress.

## Findings

| ID | Severity | Finding | Status | Evidence |
| --- | --- | --- | --- | --- |
| F-01 | **Critical** | Supabase Data API exposed every table to the public anon key, with **SELECT, INSERT, UPDATE, DELETE, TRUNCATE** and no RLS | **Fixed, live** | migration `0005`; live re-probe; `migrations.test.ts`; `npm run preflight` |
| F-02 | High | No application rate limiting (SRS §7 requires 429; §9 requires abuse limits) | Fixed | `src/server/abuse.ts`; `abuse.test.ts` |
| F-03 | High | No request-body size limit on `/send`: one request could buffer unbounded input into memory and Redis | Fixed | `readBoundedBody`; `abuse.test.ts` (declared *and* streamed) |
| F-04 | Medium | Cross-tenant disclosure: the dead-letter list (Health page, since Phase 2) showed every tenant's jobs, including recipient addresses in SES error text | Fixed | `getQueueHealth(userId)` required; `dashboard.test.ts`, `tenant-isolation.test.ts` |
| F-05 | Medium | Webhook amplification: each forged message naming a different `.pem` on the SNS host caused an outbound fetch | Fixed | negative cache for *definitive* failures only; `sns-certificate.test.ts` |
| F-06 | Medium | No security headers (clickjacking, MIME sniffing, HSTS) | Fixed; CSP report-only | `next.config.ts`; verified over HTTP; `abuse.test.ts` |
| F-07 | Medium | No master-key rotation: a leaked `ENCRYPTION_KEY` would force every tenant to re-enter credentials | Fixed | keyring + `npm run rotate:encryption-key`; `credential-security.test.ts` |
| F-08 | Medium | Duplicate send: a database error *after* SES accepted a message was retried as a send | Fixed | `acceptedBySes` on the job; resilience `db_failure_after_send` |
| F-09 | Low | API routes had no error boundary: an unexpected error returned a bare 500 with no envelope or request id | Fixed | `withErrorBoundary`; `database-recovery.test.ts` |
| F-10 | Low | Sign-out accepted cross-site POSTs (logout CSRF) | Fixed | origin check; `abuse.test.ts` |
| F-11 | Low | `getSendJobState` trusted its caller for tenant scoping | Fixed | self-scoping; `tenant-isolation.test.ts` |
| F-12 | Low | `X-Powered-By` advertised the framework | Fixed | `poweredByHeader: false` |
| F-13 | Moderate / High (advisory) | `npm audit`: PostCSS < 8.5.23 bundled by Next.js (XSS in stringify output; sourceMappingURL path traversal) | **Accepted, tracked** | see below |

### F-01 in detail

Supabase publishes every table in the `public` schema through PostgREST to
the `anon` and `authenticated` roles. The anon key is public by design (it
ships in the browser). All twelve tables were readable **and writable** with
it. An attacker could have inserted an API key for any tenant and sent mail
through that tenant's AWS account, read every user's email address, or
truncated the database.

- **Cause:** tables were created in `public` without revoking Supabase's
  default grants or enabling RLS (a Phase 1 design gap).
- **Fix:** revoke all privileges and default privileges from both roles;
  enable RLS with no policies on every table. The app connects as the table
  owner, which bypasses RLS, so it's unaffected.
- **Verified live:** reads and writes with the anon key now return
  `42501 permission denied`; 0 grants remain; RLS is on 12/12 tables.
- **Guarded:** a test fails the build if any future table lacks RLS, and
  preflight refuses to pass a database with anon grants.
- **Exposure while open:** the sensitive tables contained only the owner's own
  rows, with no sign of tampering. Reads can't be ruled out from here. Exposed
  if read: one user email, one AWS access key ID, one AES-256-GCM ciphertext
  (useless without `ENCRYPTION_KEY`, which was never exposed), and one API-key
  SHA-256 hash (irreversible for a 256-bit key). Recommended: review Supabase →
  Logs → API for `/rest/v1/` traffic, and optionally rotate the AWS key.

### F-06: CSP in report-only mode

Security headers are enforced; the Content-Security-Policy ships as
`Content-Security-Policy-Report-Only`. Next.js hydration needs inline scripts
unless nonces are threaded through every render, and an enforced CSP that's
wrong breaks the app silently in the browser, which couldn't be tested in this
environment. **To enforce:** load the app in a browser, confirm the console
shows no CSP reports, then rename the header in `next.config.ts`.

### F-13: accepted dependency advisory

The advisories affect PostCSS's *stringify output* and *source-map loading*.
PostCSS runs at build time on this repository's own CSS; no user-controlled
CSS reaches it at runtime. Exploitation needs an attacker to control the
stylesheets being built, which is code execution in CI already. The only fix
is Next.js 16, a major upgrade. **Tracked for the next framework upgrade;**
re-assess if the app ever processes user CSS.

## Reviewed and sound (no change needed)

| Area | Why it holds |
| --- | --- |
| Credential storage | AES-256-GCM, random 96-bit IV per encryption, tenant + environment bound as AAD (a ciphertext moved to another tenant's row fails authentication), versioned envelope |
| Secret display | AWS secret never returned; API-key secret shown once; only SHA-256 hashes stored |
| Secrets in logs | allow-listed log fields (no free-form spread); a test runs real flows and finds no secret in any log line or response, including AWS error text that quotes the secret |
| Authentication | every Server Action calls `requireTenant()` (static test); every API route has a named mechanism (static test); no route or action takes a tenant id from input |
| Tenant isolation | every tenant-scoped query filters by the session's tenant; a matrix test calls every function as another tenant and proves all 12 tables untouched |
| SNS webhook | signature verified before any work; cert and SubscribeURL host-restricted (SSRF-safe, redirects refused); unregistered topics refused and never confirmed |
| Templates | interpolation only; HTML-escaped values; CR/LF stripped from subjects; previews in `sandbox=""` iframes |
| Open redirect | login always redirects to `/dashboard`; no user-controlled target |
| Server Actions CSRF | Next.js origin check on every action |
| Raw HTML / eval | none anywhere (static test) |

## Guards that keep this true

`tests/unit/security-static.test.ts` (actions authenticate; routes listed with
their mechanism; `server-only` on every server module; client components never
import server code or secrets; only two `NEXT_PUBLIC_` values; no
`dangerouslySetInnerHTML`/`eval`; previews sandboxed) ·
`tests/integration/tenant-isolation.test.ts` ·
`tests/integration/credential-security.test.ts` ·
`tests/integration/abuse.test.ts` ·
`tests/integration/migrations.test.ts` (RLS on every table) ·
`npm run preflight` (Data API closed, RLS on, key decrypts).
