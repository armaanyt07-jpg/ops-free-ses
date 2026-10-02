# Observability

## Logs

Every line is one JSON object on stdout/stderr:

```json
{"level":"info","ts":"2026-09-27T10:54:13.082Z","event":"send.accepted","requestId":"req_…",
 "userId":"…","environment":"production","logId":"…","jobId":"log-…","status":"queued","durationMs":112}
```

Fields are **allow-listed** (`src/lib/api/logger.ts`), so there's no free-form
field through which a secret could slip. A test runs real flows and checks
that no API key, AWS secret, encryption key or bearer header appears in the
output. A request id follows a message from the HTTP response header, through
the job, into the worker's lines.

### Event catalogue (what to search for)

| Area | Events |
| --- | --- |
| API | `send.accepted`, `send.unauthorized`, `send.rate_limited`, `send.recipient_suppressed`, `send.idempotency_conflict`, `send.persist_failed`, `send.enqueue_failed`, `domains.verify`, `aws_connect.untrusted_response_url`, `aws_connect.answered`, `aws_connect.failed`, `aws_connect.verify_failed` |
| Worker | `worker.sent`, `worker.retryable_failure`, `worker.permanent_failure`, `worker.dead_lettered`, `worker.rate_limited`, `worker.suppressed`, `worker.no_credential`, `worker.domain_checked`, `worker.reconcile_failed`, `worker.accept_record_failed` |
| Webhook | `sns.processed`, `sns.duplicate_ignored`, `sns.subscription_confirmed`, `sns.unsubscribed`, `sns.signature_rejected`, `sns.unknown_topic`, `sns.certificate_unavailable`, `sns.processing_failed` |
| Security | `security.credential.saved/revoked/activated/deleted`, `security.aws_connect.started/callback/connected/stack_deleted`, `security.api_key.created/revoked/rotated`, `security.domain.added/removed`, `security.sns_topic.registered/removed`, `security.suppression.added/removed`, `security.template.archived/unarchived`, `security.sandbox_request.reviewed` |
| Abuse | `abuse.limiter_unavailable` (limiter failed open) |
| Errors | `error.unhandled`, with `fingerprint`, `source` (route/page/action/worker/process), redacted `message`, `frames` |

### Reading `worker.sent` timings

Every successful send logs `durationMs` (total time inside the worker) and a
`detail` string with the breakdown, for example:

```
wait=132ms credential=2160ms suppression=537ms limiter=… marking=… ses=… record=…
```

`wait` is how long the job sat in Redis before this worker took it; the rest
are the worker's steps in order. A large `credential` or `suppression` points at
database round trips, a large `ses` at the AWS call. Production currently shows
about 1.5 s in total (it was 5 s until the worker moved next to the database);
see `docs/PHASE-3.md` §10.1. Some log viewers truncate
`detail`; expand the row or download the logs to see all of it.

## Error monitoring

Unexpected errors from API routes (error boundary), pages and Server Actions
(`src/instrumentation.ts`), and the worker (`failed` hook, `unhandledRejection`,
`uncaughtException`) are all reported as `error.unhandled`:

- **`fingerprint`** is stable per bug (type + top frames), so group and count
  by it; a new fingerprint is a new bug;
- **messages are redacted**: email addresses become `[email]` and key-shaped
  strings become `[secret]`;
- the worker exits on an uncaught exception, so its supervisor restarts it
  cleanly, and in-flight jobs are recovered.

**Sentry (optional, on in production).** With a DSN set, every
`error.unhandled` is also sent to Sentry from `reportError`, grouped by the
same `fingerprint` and tagged with `source` and `route`. Browser errors in
the dashboard go too (`src/instrumentation-client.ts`,
`src/app/global-error.tsx`; the SDK loads lazily so it adds nothing to the
initial page weight). Before anything leaves, `src/lib/observability/sentry.ts`:

- redacts messages with the same rules as the log line, and drops the bound
  values from database query errors (`params: [redacted]`);
- drops request bodies, cookies and every header except `User-Agent`;
- strips query strings from every URL (`/auth/confirm` carries a sign-in
  token there);
- sends no user, IP address or local variables.

| Where | Variable | Notes |
| --- | --- | --- |
| Vercel | `NEXT_PUBLIC_SENTRY_DSN` | **plain** type, not Secret; inlined at build time, so a change needs a fresh build (push), not a redeploy |
| Railway | `SENTRY_DSN` | the same DSN |

With neither set, Sentry is off and nothing changes. Keep `@sentry/core`,
`@sentry/nextjs` and `@sentry/node` pinned to the **same exact version**:
`reportError` imports `@sentry/core` directly, and the SDKs only share their
client within one version.

Alerting: Sentry → Alerts → "a new issue is created" emails you on the first
occurrence of every new fingerprint.

**Log drains** remain an option for the full log stream (Vercel Pro → Drains;
the worker host's equivalent) to Datadog, Better Stack or Axiom.

## Health endpoints

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /api/health` | the process serves; no dependency checks | liveness probe |
| `GET /api/health/ready` | Postgres and Redis answer within 2 s; 503 otherwise; cached 5 s; reveals only ok/latency | readiness / load-balancer check, uptime monitor |
| `GET /api/health/worker` | at least one worker heartbeat is fresh (< 75 s); 503 `down` when none is, 503 `unknown` when Redis doesn't answer within 3 s; cached 5 s; reveals only a status and a count | uptime monitor for the worker |
| `/dashboard/health` | queue depth, dead letter (tenant's own), worker heartbeats, webhook lag | operators |

## Alerts to configure

| Alert | Condition | Runbook |
| --- | --- | --- |
| Readiness failing | `/api/health/ready` non-200 for 2 min | 6, 7 |
| No worker | `/api/health/worker` non-200 (UptimeRobot), or no `worker.*` lines for 5 min while sends are accepted | 3 |
| Backlog | Waiting grows for 10 min | 3 |
| Error spike | a new `error.unhandled` fingerprint, or more than 10/min | — |
| Dead-lettering | `worker.dead_lettered` rate > 1% of sends | 1, 5 |
| Webhook silent | no `sns.processed` for 1 h while sending | 4 |
| Signature failures | `sns.signature_rejected` burst | 4 |
| Reputation | bounce rate ≥ 5% or complaint rate ≥ 0.1% (overview) | 2 |
| Limiter down | any `abuse.limiter_unavailable` | 6 |
