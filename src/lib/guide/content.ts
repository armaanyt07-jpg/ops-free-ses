/**
 * Copy and code samples for the public /guide page.
 *
 * Kept as data, apart from the markup, so `tests/unit/guide.test.ts` can check
 * it against the real contracts (send schema, error codes, email statuses, IAM
 * policy). A guide that drifts from the API is worse than no guide.
 */

/** Placeholder shown in samples; the real key is only ever shown once, in the dashboard. */
export const SAMPLE_KEY = "sk_live_your_key_here";

export const SEND_EXAMPLE = {
  from: "hello@yourdomain.com",
  to: ["customer@example.com"],
  subject: "Welcome aboard",
  html: "<h1>Hello {{name}}</h1><p>Thanks for signing up.</p>",
  variables: { name: "Asha" },
} as const;

export const TEMPLATE_EXAMPLE = {
  from: "hello@yourdomain.com",
  to: ["customer@example.com"],
  templateId: "00000000-0000-4000-8000-000000000000",
  variables: { name: "Asha" },
} as const;

export function curlSample(origin: string): string {
  return `curl -X POST ${origin}/api/v1/send \\
  -H "Authorization: Bearer ${SAMPLE_KEY}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: welcome-asha-001" \\
  -d '${JSON.stringify(SEND_EXAMPLE)}'`;
}

export function nodeSample(origin: string): string {
  return `const res = await fetch("${origin}/api/v1/send", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.OPSFREE_API_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": "welcome-asha-001",
  },
  body: JSON.stringify(${JSON.stringify(SEND_EXAMPLE, null, 4).replace(/\n/g, "\n  ")}),
});

// 409 means this Idempotency-Key was already used: the first call went through.
if (res.status !== 202 && res.status !== 409) {
  const { error } = await res.json();
  throw new Error(\`\${error.code}: \${error.message} (request \${error.requestId})\`);
}
const { id } = await res.json(); // keep this to look the email up later`;
}

export function pythonSample(origin: string): string {
  return `import os, requests

res = requests.post(
    "${origin}/api/v1/send",
    headers={
        "Authorization": f"Bearer {os.environ['OPSFREE_API_KEY']}",
        "Idempotency-Key": "welcome-asha-001",
    },
    json={
        "from": "hello@yourdomain.com",
        "to": ["customer@example.com"],
        "subject": "Welcome aboard",
        "html": "<h1>Hello {{name}}</h1><p>Thanks for signing up.</p>",
        "variables": {"name": "Asha"},
    },
)

if res.status_code != 202:
    err = res.json()["error"]
    raise RuntimeError(f"{err['code']}: {err['message']} (request {err['requestId']})")
email_id = res.json()["id"]`;
}

export const ACCEPTED_RESPONSE = `{
  "id": "3f2a1c9e-8d44-4a6b-9f10-2b7c5e0d1a33",
  "status": "queued",
  "message": "Accepted for asynchronous delivery"
}`;

export const ERROR_RESPONSE = `{
  "error": {
    "code": "DOMAIN_NOT_VERIFIED",
    "message": "...",
    "requestId": "req_..."
  }
}`;

export interface Field {
  name: string;
  type: string;
  required: string;
  note: string;
}

export const REQUEST_FIELDS: Field[] = [
  { name: "from", type: "string", required: "Yes", note: "A verified domain or email address in your connected AWS account." },
  { name: "to", type: "string[]", required: "Yes", note: "1 to 50 recipients. Duplicates are removed." },
  { name: "subject", type: "string", required: "With html/text", note: "Not allowed together with templateId." },
  { name: "html", type: "string", required: "html or text", note: "Not allowed together with templateId." },
  { name: "text", type: "string", required: "html or text", note: "Plain-text version. Send both for best results." },
  { name: "templateId", type: "uuid", required: "Instead of the above", note: "A template from your dashboard. It supplies the subject, html and text." },
  { name: "variables", type: "object", required: "No", note: "Fills {{name}} placeholders in inline content or the template." },
  { name: "tags", type: "object", required: "No", note: "String key/value labels for your own bookkeeping." },
];

export interface ErrorRow {
  code: string;
  status: number;
  meaning: string;
  fix: string;
}

/** One row per code in `ERROR_CODES` (src/lib/api/errors.ts); a test enforces it. */
export const ERROR_ROWS: ErrorRow[] = [
  { code: "INVALID_REQUEST", status: 400, meaning: "The body is malformed or a field is missing or wrong.", fix: "Read the message: it names the field. Unknown fields are rejected. A 409 with this code means the Idempotency-Key was already used: the details hold the original email's id and status, and nothing was sent twice." },
  { code: "UNAUTHORIZED", status: 401, meaning: "The API key is missing, wrong or revoked.", fix: "Send Authorization: Bearer sk_live_… Create a new key in the dashboard if it was lost." },
  { code: "DOMAIN_NOT_VERIFIED", status: 403, meaning: "The from address isn't a verified domain or email address on your account.", fix: "Verify it under Domains, or send from an address you already verified." },
  { code: "RECIPIENT_SUPPRESSED", status: 403, meaning: "At least one recipient is on your blocked list (an earlier bounce or complaint). The whole request is refused and nothing is sent.", fix: "Check Blocked addresses. Remove an address only if you're sure it's valid, or drop it from to and resend." },
  { code: "RATE_LIMITED", status: 429, meaning: "You're sending faster than the per-key limit.", fix: "Slow down and retry with backoff. Reuse the same Idempotency-Key when you retry." },
  { code: "SES_THROTTLED", status: 429, meaning: "AWS said you exceeded your SES sending rate.", fix: "Retry with backoff. In the sandbox the limit is 1 email a second." },
  { code: "SES_REJECTED", status: 502, meaning: "AWS refused the message.", fix: "The message says why: usually an unverified sender or a sandbox recipient restriction." },
  { code: "QUEUE_UNAVAILABLE", status: 503, meaning: "We couldn't queue the message. Nothing was sent.", fix: "Safe to retry, ideally with the same Idempotency-Key." },
  { code: "INTERNAL_ERROR", status: 500, meaning: "Something broke on our side.", fix: "Retry once, then contact us with the requestId from the response." },
];

export interface StatusRow {
  status: string;
  meaning: string;
}

/** One row per value of `emailStatusEnum`; a test enforces it. */
export const STATUS_ROWS: StatusRow[] = [
  { status: "queued", meaning: "Accepted and stored. Waiting for a worker." },
  { status: "sending", meaning: "A worker is handing it to Amazon SES." },
  { status: "sent", meaning: "Amazon SES accepted it. Final outcome not known yet." },
  { status: "delivered", meaning: "The recipient's mail server accepted it. Needs events connected." },
  { status: "bounced", meaning: "The address doesn't exist or refused it. It's added to your blocked list. Needs events connected." },
  { status: "complained", meaning: "The recipient marked it as spam. It's added to your blocked list. Needs events connected." },
  { status: "failed", meaning: "It couldn't be sent, after retries. Open it in Activity to see why." },
  { status: "suppressed", meaning: "Skipped on purpose: the address was already on your blocked list." },
];

export interface Trouble {
  id: string;
  question: string;
  answer: string[];
}

export const TROUBLESHOOTING: Trouble[] = [
  {
    id: "dns-not-verifying",
    question: "My domain stays pending after I added the DNS records",
    answer: [
      "DNS changes usually show up within minutes but can take up to 72 hours. The page re-checks on its own; “Check now” forces it.",
      "Look at the name you pasted. Many registrars (GoDaddy, Namecheap) want only the part before your domain: for abc._domainkey.yourdomain.com enter abc._domainkey. Pasting the full name makes it abc._domainkey.yourdomain.com.yourdomain.com, which never resolves.",
      "Each record's type must be CNAME and the value must be copied exactly, including the dots. Cloudflare users: turn the proxy (orange cloud) off for these records.",
      "Check the region. The domain is created in the region of the AWS connection. If you changed regions after adding it, add the domain again.",
    ],
  },
  {
    id: "spf-fails",
    question: "SPF shows “fail” but my domain is verified",
    answer: [
      "Sending still works. Mail passes DMARC through DKIM, which is what verification proves. SPF is a belt-and-braces check.",
      "To fix it, add include:amazonses.com to your existing SPF record. If you have v=spf1 include:_spf.google.com ~all, make it v=spf1 include:_spf.google.com include:amazonses.com ~all.",
      "Never create a second SPF record. A domain with two SPF records fails SPF for everyone, including your other mail.",
    ],
  },
  {
    id: "connect-waiting",
    question: "Connect AWS says “Waiting for AWS” and never finishes",
    answer: [
      "Check the tab AWS opened. The stack must reach CREATE_COMPLETE; if you didn't tick the acknowledgement box at the bottom of the page and click Create stack, nothing is created.",
      "In AWS open CloudFormation (in the region shown in the page's address) and look at the stack named OpsFreeSES-… If it says ROLLBACK or CREATE_FAILED, open its Events tab: the first red line says why. Delete the failed stack and click Connect AWS again.",
      "If the stack finished but Ops-Free still waits, wait a minute: a brand-new role can take a few seconds to become usable. If it then says AWS would not let Ops-Free use the role, delete the stack and start again, or use an access key under Advanced.",
      "An attempt expires after two hours. Starting again is always safe.",
    ],
  },
  {
    id: "access-denied",
    question: "“Connect events” or domain setup says access denied",
    answer: [
      "The connection is missing a permission. The error names it. If you connected with one click, click Connect AWS again (it replaces the old role with one that has the current permissions). If you connected with an access key, replace the IAM user's policy with the one in step 2 (it includes SNS and configuration-set permissions) and try again.",
      "Every step is safe to repeat. Pressing the button again finishes a half-done setup.",
    ],
  },
  {
    id: "sandbox",
    question: "I can only send to a few addresses, or it says the recipient isn't verified",
    answer: [
      "New AWS accounts start in the SES sandbox: you can send only to verified addresses, up to 200 emails a day at 1 a second.",
      "For testing, send to success@simulator.amazonses.com (delivered), bounce@simulator.amazonses.com or complaint@simulator.amazonses.com. These work in the sandbox and show up in Activity.",
      "To send to anyone, open Start sending to anyone in the dashboard. It prepares the request for AWS, which usually reviews it within about a day.",
    ],
  },
  {
    id: "stuck-sent",
    question: "Emails stay on “sent” and never become “delivered”",
    answer: [
      "Delivery, bounce and complaint outcomes come from Amazon SNS, which is normally set up when you connect AWS. If the dashboard still shows Connect events, click it (or see step 6 below).",
      "Emails sent before events were connected stay on “sent”. Only new emails get an outcome.",
    ],
  },
  {
    id: "lost-key",
    question: "I lost my API key",
    answer: [
      "Keys are shown once and stored only as a hash, so they can't be recovered. Create a new key under API keys, update your app, then revoke the old one.",
    ],
  },
  {
    id: "region",
    question: "Which AWS region should I use?",
    answer: [
      "The region where your SES account is set up, usually the one closest to your users. SES identities and the sandbox are per region, so verify your domain in the same region you connect.",
    ],
  },
];
