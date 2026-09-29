# Incident runbook

For each incident: **how you notice → first moves → diagnosis → fix →
confirm**. Log events are named as they appear in the JSON logs
(`docs/operations/OBSERVABILITY.md`). SRS §17 scenarios are covered first.

**General first moves:** find the request id or job id if there is one (every
API response carries `X-Request-Id`), and check `/api/health/ready` and
`/dashboard/health`.

---

## 1. SES throttling spike (SRS §17)

- **Notice:** `worker.rate_limited` and `worker.retryable_failure` with
  `SES_THROTTLED`/`TooManyRequestsException`; the Delayed count rises on
  Queue & health.
- **Diagnose:** AWS page → max send rate and 24 h quota (re-validate to
  refresh). Has the tenant's quota dropped? Is a sandbox account at 1/s?
- **Fix:** the limiter already paces to the stored `ses_max_send_rate`. If AWS
  *lowered* the quota, re-validate the credential so the limiter picks up the
  new rate. SRS: "Reduce concurrency before increasing quota". Lower
  `WORKER_CONCURRENCY` first, then request a quota increase (the Production
  access page generates the text).
- **Confirm:** Delayed drains; no new `SES_THROTTLED` failures.

## 2. Bounce or complaint spike (SRS §17)

- **Notice:** Overview bounce rate over 5% or complaint rate over 0.1% (AWS's
  warning thresholds, shown on the page); Errors → bounces by type.
- **Diagnose:** Errors page, by type: *Permanent* means list quality,
  *Transient* is usually recipient-side. Filter Activity by template and date:
  one campaign or template? Recent change in how recipients are acquired?
- **Fix:** suppression is automatic for hard bounces and complaints (if SNS is
  connected; check Webhooks). "Pause risky sending if required": revoke the
  API key used by the offending sender (dashboard, immediate) or archive the
  template. Never unsuppress in bulk.
- **Confirm:** rates fall back under the thresholds over the next window.

## 3. Queue backlog (SRS §17)

- **Notice:** Waiting grows on Queue & health / the Overview queue card;
  "No worker running".
- **Diagnose:** worker heartbeats (Queue & health). Missing → worker down.
  Present but slow → SES latency or rate limiting (see 1). `/api/health/ready`
  queue = false → Redis (see 6).
- **Fix:** restart or scale the worker (stateless; scale horizontally, since
  the limiter is distributed).
- **Confirm:** Waiting trends to 0; heartbeats healthy.

## 4. Webhook outage (SRS §17)

- **Notice:** "Last event" on Queue & health goes stale while sends continue;
  `sns.processing_failed`, `sns.certificate_unavailable` or
  `sns.signature_rejected` bursts.
- **Diagnose:** `curl -X POST https://<app>/api/v1/webhooks/aws-sns` should
  answer 400 (not 5xx or a timeout). Webhooks page: topic still `confirmed`?
  An `unsubscribed` topic means someone removed the subscription in AWS.
  Signature rejections: raw message delivery was switched on?
- **Fix:** restore availability; re-subscribe if unsubscribed. 5xx answers
  make SNS retry (by default for about a minute). Events lost beyond that are
  gone from SNS, but suppression can still be caught up from SES's
  account-level suppression list.
- **Confirm:** new events arrive; replaying any captured messages is safe
  (idempotent, order-independent; tested).

## 5. Credential failure (SRS §17)

- **Notice:** `worker.permanent_failure` with `AccessDeniedException`,
  `InvalidClientTokenId` or `SignatureDoesNotMatch`; Errors page groups them
  under "AWS rejected the stored credential".
- **Fix:** SRS: "Mark the credential invalid, stop affected jobs, ask the user
  to rotate/revalidate keys, never expose the secret". Revoke the credential on
  the AWS page (jobs fail fast as `NO_ACTIVE_CREDENTIAL` instead of retrying),
  have the tenant rotate the IAM key and save the new one (validated before
  it's stored).
- **Confirm:** re-validate succeeds; new sends reach `sent`.

## 6. Redis outage

- **Notice:** `/api/health/ready` queue = false; `send.enqueue_failed`; the
  API answers **503 QUEUE_UNAVAILABLE** (by design: no 202 without a durable
  job).
- **Fix:** restore Redis. Workers reconnect by themselves (tested: 2 s outage,
  0 lost). The rate limiter fails open meanwhile.
- **If Redis data was lost:** run `npm run reconcile` (dry run), review, then
  `npm run reconcile -- --apply`. Stranded messages are closed as `JOB_LOST`
  so callers can resend. See `BACKUP-RECOVERY.md`.

## 7. Database incident (SRS §17)

- **Notice:** `/api/health/ready` database = false; `error.unhandled` from
  routes; the API answers 500/503 with request ids.
- **Behaviour while down:** sends are refused (never a 202 without a log row);
  queued jobs retry with backoff and complete once the DB returns, sending
  exactly once (tested). Webhooks answer 5xx so SNS retries.
- **Restore:** SRS: "restore from managed backups and reconcile using
  idempotent identifiers". Follow `BACKUP-RECOVERY.md` §Restore.

## 8. Suspected Data API exposure (Phase 7 F-01 class)

- **Notice:** `npm run preflight` fails "Data API exposes no tables", or a new
  table was added without RLS (the test suite fails).
- **Fix immediately:** apply migration `0005` (it's idempotent), or run its SQL
  by hand. Then check Supabase → Logs → API for `/rest/v1/` traffic.
- **Confirm:** a request with the anon key to `/rest/v1/api_keys` returns 401
  `42501`.

## 9. Leaked secret

| Secret | Do this |
| --- | --- |
| A tenant's API key | revoke it (dashboard), or rotate with grace `now`; auth rejects it immediately |
| A tenant's AWS key | tenant deactivates it in IAM, then saves a new one; revoke the stored one meanwhile |
| `ENCRYPTION_KEY` | rotate: `BACKUP-RECOVERY.md` §Key rotation (no tenant action needed) |
| `DATABASE_URL` password | reset in Supabase; update app and worker env; redeploy |
| Supabase anon key | public by design; harmless while F-01 stays fixed |

## 10. Duplicate-send report

- **Diagnose:** Activity → message detail: timeline and the queue job's
  attempts. The platform re-sends only if a worker died in the milliseconds
  between SES accepting and the acceptance being recorded in Redis, or if the
  caller retried without an `Idempotency-Key`.
- **Fix:** ask the caller to send `Idempotency-Key` on every request.
