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
| API | `send.accepted`, `send.unauthorized`, `send.rate_limited`, `send.recipient_suppressed`, `send.idempotency_conflict`, `send.persist_failed`, `send.enqueue_failed`, `domains.verify` |
| Worker | `worker.sent`, `worker.retryable_failure`, `worker.permanent_failure`, `worker.dead_lettered`, `worker.rate_limited`, `worker.suppressed`, `worker.no_credential`, `worker.domain_checked`, `worker.reconcile_failed`, `worker.accept_record_failed` |
| Webhook | `sns.processed`, `sns.duplicate_ignored`, `sns.subscription_confirmed`, `sns.unsubscribed`, `sns.signature_rejected`, `sns.unknown_topic`, `sns.certificate_unavailable`, `sns.processing_failed` |
| Security | `security.credential.saved/revoked/activated/deleted`, `security.api_key.created/revoked/rotated`, `security.domain.added/removed`, `security.sns_topic.registered/removed`, `security.suppression.added/removed`, `security.template.archived/unarchived`, `security.sandbox_request.reviewed` |
| Abuse | `abuse.limiter_unavailable` (limiter failed open) |
| Errors | `error.unhandled`, with `fingerprint`, `source` (route/page/action/worker/process), redacted `message`, `frames` |

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

**Forwarding:** point the platform log drain (Vercel → Log Drains; the
worker host's equivalent) at your tool (Datadog, Better Stack, Axiom, or
Sentry via its log integration). No SDK is needed; everything is structured
JSON. Choosing and wiring a destination is part of deployment.

## Health endpoints

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /api/health` | the process serves; no dependency checks | liveness probe |
| `GET /api/health/ready` | Postgres and Redis answer within 2 s; 503 otherwise; cached 5 s; reveals only ok/latency | readiness / load-balancer check, uptime monitor |
| `/dashboard/health` | queue depth, dead letter (tenant's own), worker heartbeats, webhook lag | operators |

## Alerts to configure

| Alert | Condition | Runbook |
| --- | --- | --- |
| Readiness failing | `/api/health/ready` non-200 for 2 min | 6, 7 |
| No worker | no `worker.*` lines for 5 min while sends are accepted | 3 |
| Backlog | Waiting grows for 10 min | 3 |
| Error spike | a new `error.unhandled` fingerprint, or more than 10/min | — |
| Dead-lettering | `worker.dead_lettered` rate > 1% of sends | 1, 5 |
| Webhook silent | no `sns.processed` for 1 h while sending | 4 |
| Signature failures | `sns.signature_rejected` burst | 4 |
| Reputation | bounce rate ≥ 5% or complaint rate ≥ 0.1% (overview) | 2 |
| Limiter down | any `abuse.limiter_unavailable` | 6 |
