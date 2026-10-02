# Phase 9 — The sandbox and "waiting for AWS" experience

Status: **code-complete**. 69 new tests, and the full suite passes. Not yet
seen signed in on the live dashboard; the components were rendered and checked
at desktop and phone width on a temporary preview page.

## Why

A new AWS account starts in the SES sandbox, and getting out takes an AWS
review. Before this phase the app treated that as a single static warning:

- Overview, AWS page and setup summary all said only "SES sandbox", whether the
  user had never applied, had applied and was waiting, or had been denied.
- The review status AWS reports was shown on one page only, and only as fresh as
  the last time someone pressed *Re-validate*.
- Nothing told a waiting user what they *could* do, so the wait looked like a
  dead end, which is where a new user is most likely to leave.

This phase makes the wait a first-class state, and helps users submit a request
that is ready. (It does not change the Phase 8 option of verifying an email
address instead of a domain. That solves *which sender* AWS accepts; the sandbox
limits *who you can send to*, and applies either way.)

## Scope → where it lives

| Item | Deliverable |
| --- | --- |
| One production-access state | `src/lib/sandbox/access-state.ts`: `accessState()` and `describeAccess()` turn AWS's snapshot into `not_connected`, `unknown`, `not_requested`, `pending`, `syncing`, `denied`, `failed` or `granted`, with the title, summary, "what you can do now" list and next action. Pure |
| The card | `src/components/dashboard/production-access-card.tsx`, shown on the Overview (compact, only while sandboxed), the AWS page and the sandbox page. Status is never colour alone: icon plus label |
| Fresh status without a background job | `src/server/sandbox-refresh.ts`: on a dashboard load, re-asks AWS (`GetAccount`) only if the account is still sandboxed and the snapshot is older than 15 minutes. 3 s timeout; failures are logged and the page shows the snapshot it had. An account with production access costs no AWS calls |
| "Before you submit" | `src/lib/sandbox/readiness.ts` and `readiness-checklist.tsx` on the sandbox page. Advisory only; shown while there is a request to prepare (not while AWS is reviewing one, and not once granted) |

## What the user sees in each state

| State | Meaning | Says |
| --- | --- | --- |
| `not_requested` | Sandbox, AWS shows no review | Your limits; what works now; **Start sending to anyone** (or **Open your prepared request** if one was reviewed here) |
| `pending` | AWS review PENDING | "Waiting for AWS", AWS's own timing statement, the case id, what works now |
| `syncing` | AWS says GRANTED but the account still reports sandbox limits | Re-check in a few minutes |
| `denied` | AWS review DENIED | AWS may not give a reason; reply on the case with more detail; **Review your answers** |
| `failed` | AWS review FAILED | AWS had an internal error; submit again |
| `granted` | `ProductionAccessEnabled` | "Production access is on". Nothing shown on the Overview |

"What you can do right now" is the same for every sandboxed state: build and
test the whole integration; send to addresses verified in SES, up to the limits
in the user's own snapshot (AWS's documented 200 a day and 1 a second if the
snapshot has none); use `success@`, `bounce@`, `complaint@simulator.amazonses.com`.

## The checklist

Each item is `ok` or `consider`. There is no failure state and nothing gates
the review step.

| Item | `ok` when | Grounded in |
| --- | --- | --- |
| Sender | a verified domain, or a verified address | platform fact. A domain is **never required** |
| Authentication | DKIM, SPF and DMARC all pass (skipped without a domain) | last domain check; "unknown" is not a pass |
| Bounce and complaint handling | SES events connected *and* arriving | the same fact Phase 6 requires before claiming it |
| Test send | something has been sent | `email_logs` |
| Website | a valid URL in the answers | the questionnaire's own check |
| Use case | 200+ characters | the user's answer |
| Recipient permission | (appears only if purchased lists are selected) | the user's answer |

## Decisions

- **Refresh on page load, not a background job**, with a 15-minute cooldown and
  a 3 s timeout (the agreed default). The cost is one AWS call per 15 minutes
  per active sandboxed user, and the status can be up to 15 minutes old.
- **Advisory checklist, never a gate** (the agreed default): AWS decides, and a
  user with a thin answer must still be able to proceed.
- **Phase 6's rule holds.** The platform never states or predicts an approval.
  The one timing statement is attributed to AWS ("AWS says its Support team
  gives an initial response within 24 hours, and that it can take longer"). A
  test fails if the copy gains words like *guarantee*, *likely* or *will be
  approved*.
- **The claims on the page come from AWS's own request guide**
  (docs.aws.amazon.com/ses/latest/dg/request-production-access.html, read
  2026-10-02): the 24-hour initial response and "might take longer" if more
  information is needed; that the request can't be edited while under review;
  that the form asks for a website URL and mail type and has the sender confirm
  they only email people who asked and have a bounce and complaint process; and
  that verifying a domain first is "a best practice that helps to get your
  production access request approved faster". The guide does not say a domain is
  required, and neither does the app.

## Deliberately not in this phase

- **Emailing the user when AWS approves or denies.** It needs a scheduled job
  that checks accounts in the sandbox and a sender for the email. The next
  piece of work, and the biggest retention win.
- **Adding test recipients from the dashboard**, a denial-recovery flow beyond
  the message and the link back to the questionnaire, and analytics on where
  users drop off.
- Submitting the request to AWS for the user, and any prediction of approval.
- Anything on the public `/guide` page.

## Honest limits

- **Status can be up to 15 minutes stale** unless the user presses *Re-validate*,
  and it is only refreshed when they open a dashboard page. Nobody is told when
  it changes.
- **The app cannot tell whether a user submitted.** It knows only what AWS
  reports; a request prepared here but never submitted shows as `not_requested`
  with a prompt to submit it.
- **AWS does not publish its approval criteria**, and the community reports
  that denials often come without a detailed reason. The checklist is
  therefore built from AWS's documented form and from facts the platform
  measures, not from inferred rules.
- **Seen on a preview page, not signed in.** The Overview, AWS and sandbox
  pages need a real session to view; their wiring is covered by typecheck and
  the unit tests of the logic, not by a browser test.
- **Refresh adds one AWS call's latency** (up to 3 s) to a page load when the
  snapshot is stale and the account is sandboxed.

## Tests

69 new, in `tests/unit/`, mutation-checked (each of these was broken on
purpose and caught):

- `access-state.test.ts`: every state and its priority (production access beats
  a stale review status), limits from the snapshot with the documented
  fallback, AWS attribution of the 24-hour claim, no forbidden wording, the
  prepared-request path.
- `readiness.test.ts`: every item and boundary, a domain never required, an
  address-only user not marked down, "unknown" never a pass, no forbidden wording.
- `sandbox-refresh.test.ts`: cooldown boundary (`>=`), no refresh once granted,
  no credential, AWS error, AWS never answering, tenant and environment scoping.

Mutations caught: cooldown `>=` to `>`, dropping the production-access guard,
dropping the AWS attribution, and disabling the authentication check.
