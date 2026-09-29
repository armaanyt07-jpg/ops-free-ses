# Backup and recovery

## What holds state, and how it's protected

| Store | Holds | Protection | Loss means |
| --- | --- | --- | --- |
| PostgreSQL (Supabase) | everything durable: tenants, credentials (encrypted), keys (hashed), logs, events, templates, suppression, audit | Supabase managed backups (daily, and point-in-time recovery on paid plans; **check what your plan includes** in Supabase → Database → Backups) + the logical backup below | recover from backup, then reconcile |
| Redis (Upstash) | queued jobs **including message bodies** until delivered; rate-limit buckets | provider-managed persistence | undelivered messages lost; reconcile closes them out |
| `ENCRYPTION_KEY` | the only way to read stored AWS secrets | **you** — back it up separately from the database | every stored credential unreadable; tenants must re-enter them |

**Keep `ENCRYPTION_KEY` and database backups apart.** A backup plus the key is
every tenant's AWS secret in plaintext; a backup without the key is useless
without the tenant re-entering credentials. Store the key in a password
manager or secrets manager that is not the database's backup location.

## Targets

| | Target | Basis |
| --- | --- | --- |
| RPO, database | 24 h with daily backups; minutes with point-in-time recovery | Supabase plan |
| RPO, queue | 0 for acknowledged writes with AOF `always`-equivalent durability | tested: SIGKILLed Redis lost 0 of 300 jobs |
| RTO | about 1 hour: restore + redeploy + reconcile | procedure below |

## Logical backup (independent of the provider)

```bash
# Schema + data, compressed, custom format (restorable table by table).
pg_dump "$DATABASE_URL_DIRECT" --format=custom --no-owner --no-privileges \
  --schema=public --schema=drizzle --file "ops-$(date +%F).dump"
```

Use the **direct** (port 5432) connection string, not the transaction pooler.
Schedule it daily, and store it encrypted, away from `ENCRYPTION_KEY`.

## Restore

1. **Stop writers:** scale the worker to 0; put the app in maintenance or
   revoke API keys temporarily.
2. **Restore the database:** Supabase → Backups (or PITR) → restore; or
   `pg_restore --clean --no-owner -d "$DATABASE_URL_DIRECT" ops-<date>.dump`.
3. **Check it:** `npm run preflight` checks that migrations are applied,
   **the Data API is still locked down** (re-apply migration `0005` if not —
   a restore can bring back old grants), RLS is on, and every stored
   credential decrypts with the configured key.
4. **Bring the worker back.** Jobs whose log rows are older than the backup
   update rows that no longer exist (a harmless no-op), and the email is
   still delivered.
5. **Reconcile the queue:** `npm run reconcile` (dry run), then
   `-- --apply`. Messages whose jobs no longer exist are closed as `JOB_LOST`.
6. **Events since the backup:** delivery, bounce and complaint events received
   after the backup are gone from `sns_events`. Replaying captured SNS messages
   is safe and converges to the same state (tested: order-independent,
   duplicate-proof). Events not captured are not recoverable from SNS.
7. **Reopen**, and watch Queue & health and the Errors page.

The drill for steps 2–3 runs in `tests/resilience/database-recovery.test.ts`
(backup → deletion → restore: 52 rows back, RLS and constraints intact).

## Key rotation (`ENCRYPTION_KEY`)

No tenant action is required.

1. Generate a key: `openssl rand -base64 32`.
2. Set `ENCRYPTION_KEY_PREVIOUS` to the **old** key and `ENCRYPTION_KEY` to
   the **new** one, on both the app and the worker; deploy. Both keys decrypt
   from now on; new saves use the new key.
3. `npm run rotate:encryption-key`. It's idempotent and reports
   `{ total, rotated, failed }`.
4. `failed` must be 0. Anything else is a row neither key can read: find it
   with preflight and have that tenant re-enter the credential.
5. Remove `ENCRYPTION_KEY_PREVIOUS`; deploy; `npm run preflight`.
6. Retire the old key from your secret store once no backup still needs it
   (backups taken before rotation are encrypted with the old key).

Tested end to end in `tests/integration/credential-security.test.ts`.
