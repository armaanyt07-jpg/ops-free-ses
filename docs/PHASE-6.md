# Phase 6 — AWS Sandbox Exit Assistant

Status: **code complete**. 586 tests pass. Verified on the live Supabase
database and against your real AWS account (read-only `GetAccount`: sandbox,
no review on record). **Not yet used in a browser.**

Source of truth: `docs/Ops-Free_Amazon_SES_Engine_SRS.pdf`, §13: "The
generated request must be clearly marked as a draft for human review. It must
never fabricate compliance evidence or guarantee approval."

---

## 1. Scope → where it lives

`/dashboard/sandbox` ("Production access" in the nav). Logic:
`src/lib/sandbox/request.ts` (pure) and `src/server/sandbox.ts`.

| Scope item | How |
| --- | --- |
| Interactive questionnaire | six steps, saved as a draft at each step, per environment |
| Expected sending volume | per day (required), per month and peak/second (optional) — stated as *estimates* |
| Product/use-case description | free text, at least 80 characters, quoted verbatim |
| Recipient acquisition process | methods (checkboxes) + description |
| Bounce/complaint handling | the user's own descriptions, plus an optional platform fact (§2.3) |
| Suppression strategy | the user's own description |
| Domain authentication status | SES-verified domains with DKIM/SPF/DMARC results, cited only if ticked |
| Requested region/quota | region (defaults to the credential's), optional daily quota and rate → separate quota-request text |
| AWS Support request generator | output shaped to SES `PutAccountDetails` / the console form |
| Human-review step before submission | three confirmations, bound to a hash of the exact text; copy enabled only after |

---

## 2. How fabrication is prevented — by construction, then by test

### 2.1 The generator can only arrange

`generateRequest` is deterministic: no model, no paraphrasing. Its output is
made of exactly three things:

1. the user's answers, **verbatim**;
2. fixed headings and connectors that assert nothing ("Expected volume:");
3. platform facts the user **ticked**, which are offered only when true (§2.3).

**A blank answer produces no section.** Nothing is defaulted, estimated or
filled in: no monthly figure derived from a daily one, no "we follow best
practice". Every section carries its `source`, which the review step shows
next to it.

### 2.2 The structural test

A blocklist of claim words failed during mutation testing: a mutation
appending "We follow all applicable email regulations." passed every test,
because "regulations" wasn't on the list. A blocklist can never be complete.

The guard that replaced it fills every answer with a placeholder, generates
with every option on, and pins the **skeleton**: everything the generator says
on its own. Any new sentence, claim or connective changes the skeleton and
fails the test, so adding one has to be a deliberate, reviewed change. A second
test checks that every number in the output is one the user supplied. That
test caught the generator writing "per 24 hours" (a number the user never
gave), and the wording was changed to "per day".

### 2.3 Platform facts: offered only when demonstrably true

| Fact | Offered only when | Why the stricter bar |
| --- | --- | --- |
| Domain authentication | SES reports the domain verified | an unverified domain is never cited, even if ticked |
| "Bounces and complaints are suppressed automatically" | an SNS topic is confirmed **and** SES events actually arrived in the last 30 days | a confirmed subscription alone doesn't prove SES publishes to it |
| Measured bounce/complaint rates | the above, **and** outcomes were recorded | without SNS, rates compute as 0% because nothing was measured. Citing that to AWS would be fabrication by omission. |

A fact that isn't available is shown **disabled, with the reason**, so the user
understands why it can't be claimed.

### 2.4 No approval status is ever implied

The only status shown is AWS's own, from `GetAccount` →
`Details.ReviewDetails.Status` (PENDING / GRANTED / DENIED / FAILED) and the
case ID, labelled "reported by AWS" with the time it was asked. The generated
text contains no status or outcome language (tested). The review checklist
makes the user confirm that AWS alone decides.

### 2.5 The review is bound to the exact text

The reviewer confirms three statements: the content is accurate, the numbers
are their own estimates, and AWS decides. The review stores
**SHA-256 of the exact generated text**. The server regenerates the text and
compares hashes before accepting the review, and on every page load:

- editing any answer clears the review;
- **a platform fact changing underneath** (a domain re-checked, new metrics)
  changes the text, the hash stops matching, and the request needs reviewing
  again;
- copy buttons and the console link appear only while the review matches the
  current text.

Nobody can end up copying text they didn't read.

### 2.6 The platform does not submit

The output mirrors the five content fields of SES `PutAccountDetails`
(verified against the installed SDK): `MailType`, `WebsiteURL`,
`UseCaseDescription` (≤ 5,000 characters, enforced), `ContactLanguage` and
`AdditionalContactEmailAddresses`. The user pastes it into the SES console.
Auto-submitting would need an extra IAM permission (`ses:PutAccountDetails`)
and would make an irreversible, outward-facing request on the user's behalf.
It's deliberately left out.

---

## 3. Advice, never edits

`adviceFor` warns without changing any answer. It flags purchased or rented
lists (prohibited by the AWS Acceptable Use Policy; the answer is still
included, never hidden or reworded), marketing mail without unsubscribe
handling, no verified domain, SNS not connected, a quota more than 10× the
expected volume, and a thin use-case description.

---

## 4. Schema

Migration `drizzle/0004_phase6_sandbox_assistant.sql`. Additive; applied to
Supabase.

| Change | Why |
| --- | --- |
| `sandbox_requests`: answers, `reviewed_at`, `reviewed_by`, `reviewed_hash`; unique per tenant + environment | the draft and its human sign-off |

`GetAccount`'s review status and case ID were added to the stored account
snapshot (no schema change; it's the existing jsonb column).

---

## 5. Verification

**586 tests, 27 files** (Phase 5: 547).

| File | Tests | Covers |
| --- | --- | --- |
| `unit/sandbox-request.test.ts` | 22 | required answers; verbatim quoting; **every number traceable to input**; no claim/status language; **pinned skeleton**; blanks omitted; facts opt-in *and* true; `PutAccountDetails` mapping; advice |
| `integration/sandbox.test.ts` | 14 | facts only when true (domain status, SNS + real events, no 0% metrics); review bound to hash; edits and **changed facts** invalidate it; three confirmations required; isolation; AWS status read verbatim from `GetAccount`; **no AWS call** in any assistant flow |
| `integration/pages-render.test.ts` | +3 | the page incomplete, drafted-and-unreviewed (no copy), reviewed (copy + console link, no claims) |

**Mutation-checked.** Each of these, broken on purpose, fails the suite:

- inventing a monthly volume from the daily one
- citing unverified domains
- claiming auto-suppression when inactive
- appending a compliance claim (after the skeleton fix)
- trusting a topic without events
- offering 0% metrics without outcomes
- keeping the review after an edit
- accepting a review of stale text

**Live:** the draft, build, hash-bound review and edit-clears-review all ran on
Supabase through postgres-js. One real, read-only `GetAccount` returned:
sandbox, no review reported.

**Still to do by hand:**

- [ ] walk the questionnaire in a browser
- [ ] a real submission to AWS (yours to make, deliberately), then Re-validate
      to see AWS's status appear
