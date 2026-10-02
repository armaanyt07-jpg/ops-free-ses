# Phase 10 — One-click "Connect AWS"

Status: **code-complete, tested against mocks; not yet proven against real AWS**
(that needs the operator-side stack below, which only the owner can create).
Access keys remain, as "Advanced".

## Why

The access-key connection is the hardest step in the product: a new user has to
create an IAM user, paste a policy, generate keys and paste them into our app.
It is also the step that asks them to hand us long-lived secrets. Approved as
a direction on 2026-09-30 ("IAM-role connect after deployment"); built
2026-10-02, with the fully automatic callback variant chosen over "paste your
account ID".

## How it works

1. The customer picks their SES region and presses **Connect AWS**.
   `startConnection` writes an `aws_connections` row with a fresh random
   **ExternalId** (ours to mint, never theirs) and returns an AWS console
   *quick-create* link pre-filled with it.
2. In their AWS console they tick one acknowledgement and press **Create
   stack**. The template (`src/lib/aws/connect-template.ts`, also served at
   `/aws-connect.yaml` so it can be read first) creates one IAM role,
   `OpsFreeSES-<id>`, whose trust policy names only the platform's IAM user and
   requires their ExternalId. Its permissions are exactly the access-key
   option's policy (`iam-policy.ts`).
3. The stack's custom resource publishes the role's ARN to **our SNS topic**.
   SNS delivers it to `POST /api/v1/webhooks/aws-connect`, which verifies the
   SNS signature, requires our exact topic ARN, records the role against the
   ExternalId, and answers CloudFormation (a PUT to its presigned S3 URL).
4. The dashboard polls. `checkConnection` **proves** the role by assuming it
   with the platform identity and calling `GetAccount` through it; only then is
   a `role` credential stored. The callback is a hint, not proof: a forged one
   can at worst fail a pending attempt.
5. Sends and the other AWS calls (events setup, Route 53) get short-lived
   credentials from `awsCredentialsFor` (`src/lib/aws/credentials.ts`): STS
   `AssumeRole`, cached per role, **15-minute sessions** refreshed with under 2
   minutes left, concurrent sends sharing one call.

Deleting the stack deletes the role; CloudFormation tells us (Delete), the
credential is deactivated, and even a warm worker loses access within 15
minutes.

## Data model (migration `0009`)

- `aws_credentials`: `kind` (`access_key` | `role`), `role_arn`, `external_id`;
  `access_key_id` and `secret_access_key_ciphertext` become nullable, and the
  `aws_credentials_kind_shape` CHECK keeps the two shapes exclusive. This
  loosens two baseline columns, on purpose.
- `aws_connections`: one row per click (RLS on, like every table since 0005).
  Only one `pending` row per tenant; at most 6 starts per tenant per hour.

## Security notes

- **ExternalId** stops a confused-deputy attack (customer A cannot make us
  assume customer B's role): the role only trusts us when we present the id we
  minted for that tenant.
- **The platform IAM user** (`PLATFORM_AWS_*`) is a high-value secret: it can
  assume every customer's role, but only with each one's ExternalId, and only
  roles named `OpsFreeSES-*`. Vercel and the worker hold it; nothing else
  should. If it leaks, rotate its access key (IAM console) and redeploy: customer
  roles trust the user, not the key, so nothing needs redoing on their side.
  Do **not** delete and recreate the IAM user: IAM pins trust to the user's
  unique id, so every customer would have to reconnect.
- **The SNS topic accepts publishes from any account** (customers' stacks
  publish to it). That is why the route checks the signature and exact topic,
  why a message is never trusted until the role is actually assumed, and why
  the PUT back is restricted to AWS's CloudFormation response buckets
  (`isTrustedResponseUrl`), so a crafted message cannot aim a server-side
  request at an internal address. Rate-limited per IP like the other webhook.
- No customer secret exists in this path to store, log or leak.

## Operator setup (once, in YOUR AWS account; about 15 minutes)

You need these only once; customers never see them.

1. **Create the platform stack.** AWS console → CloudFormation, region
   **ap-south-1** (the topic's region is the region of every customer stack) →
   Create stack → upload `docs/operations/aws-connect-platform.yaml`. Give a
   globally unique bucket name; leave `WebhookUrl` empty. When it finishes, the
   **Outputs** tab lists the three values you need.
2. **Create the platform access key.** IAM → Users → `ops-free-platform` →
   Security credentials → Create access key ("application running outside
   AWS"). Keep the secret out of chat and out of `.env.example`.
3. **Set environment variables** in **Vercel and the Railway worker** (both
   need them; the worker assumes the roles when sending). Names are in
   `.env.example`: `PLATFORM_AWS_ACCESS_KEY_ID`, `PLATFORM_AWS_SECRET_ACCESS_KEY`,
   `PLATFORM_AWS_PRINCIPAL_ARN`, `AWS_CONNECT_TOPIC_ARN`,
   `AWS_CONNECT_TEMPLATE_URL`. All five or none.
4. **Deploy the code** and the migration (`npm run db:migrate`, now 0000-0009).
5. **Upload the template.** Download `https://<your-domain>/aws-connect.yaml`
   and upload it to the bucket at exactly `connect/opsfree-connect.yaml`
   (S3 console → upload). **Re-upload whenever `CONNECT_TEMPLATE_VERSION`
   changes.**
6. **Subscribe the topic.** Update the platform stack and set `WebhookUrl` to
   `https://<your-domain>/api/v1/webhooks/aws-connect`. The app confirms the
   subscription by itself (look for `sns.subscription_confirmed` with
   `detail: aws-connect` in the logs).
7. **Try it** with a throwaway AWS account if you have one: Dashboard → AWS →
   Connect AWS → Create stack → the page should flip to Connected within a
   minute. Then send an email.

Until step 3 the dashboard shows the access-key flow exactly as before.

## Not yet proven

Everything above is covered by unit and integration tests with AWS mocked at
the SDK boundary (`tests/unit/aws-connect.test.ts`,
`tests/integration/aws-connect*.test.ts`). The first run against real AWS
(operator stack, a customer-account stack, the STS assume, the custom-resource
round trip, and cross-region S3 template fetch from the quick-create link) is
the open item. If AWS rejects the S3 URL's region, move the template bucket to
the same region as the topic (the platform stack already does).

## Files

| Concern | Where |
| --- | --- |
| Template, ExternalId, console link, callback parsing, response PUT | `src/lib/aws/connect-template.ts`, `src/lib/aws/connect.ts` |
| Platform identity and config | `src/lib/aws/platform.ts` |
| STS assume, caching, SDK credential provider | `src/lib/aws/credentials.ts` |
| Lifecycle: start, callback, verify | `src/server/aws-connect.ts` |
| Role credential storage | `src/server/credentials.ts` (`storeRoleCredential`) |
| Webhook | `src/app/api/v1/webhooks/aws-connect/route.ts` |
| Template download | `src/app/aws-connect.yaml/route.ts` |
| UI | `connect-aws.tsx`, `aws-connect-options.tsx` (dashboard), AWS page, setup guide |
| Operator stack | `docs/operations/aws-connect-platform.yaml` |
