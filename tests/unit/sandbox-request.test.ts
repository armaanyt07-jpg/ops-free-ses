import { describe, expect, it } from "vitest";

import {
  adviceFor,
  generateRequest,
  missingAnswers,
  reviewableText,
  type Draft,
  type PlatformFacts,
} from "@/lib/sandbox/request";

/**
 * Phase 6 exit criterion, as tests: the request is "based only on
 * user-provided information" and "MUST NOT fabricate compliance claims,
 * customer information, sending volumes, or AWS approval status".
 */
const COMPLETE: Draft = {
  region: "ap-south-1",
  mailType: "TRANSACTIONAL",
  companyName: "Quokka Labs",
  websiteUrl: "https://quokka.example",
  useCase:
    "Quokka Labs is a bookkeeping app for freelancers. We send sign-up confirmations and password resets when a user acts in the app.",
  emailTypes: ["account_verification", "password_reset"],
  dailyVolume: 1234,
  acquisitionMethods: ["signup"],
  acquisitionDetails: "Every recipient created their own account on quokka.example and entered their address.",
  bounceHandling: "We stop sending to any address that hard-bounces.",
  complaintHandling: "Complaining addresses are removed and never mailed again.",
  suppressionStrategy: "We check our own suppression list before each send.",
  language: "EN",
};

const NO_FACTS: PlatformFacts = { domains: [], autoSuppressionActive: false, metrics: null };

const FACTS: PlatformFacts = {
  domains: [
    { id: "d1", domain: "quokka.example", sesVerified: true, dkim: "pass", spf: "pass", dmarc: "pass", dmarcPolicy: "quarantine", checkedAt: "2026-09-20T10:00:00.000Z" },
    { id: "d2", domain: "unverified.example", sesVerified: false, dkim: "fail", spf: "fail", dmarc: "fail", dmarcPolicy: null, checkedAt: null },
  ],
  autoSuppressionActive: true,
  metrics: { days: 30, reachedSes: 4321, withOutcome: 4300, bounceRate: 0.0123, complaintRate: 0.0004, measuredAt: "2026-09-27T00:00:00.000Z" },
};

const output = (d: Draft, f: PlatformFacts = NO_FACTS) => {
  const r = generateRequest(d, f);
  return `${r.fields.useCaseDescription}\n${r.quotaRequest ?? ""}`;
};

/** Every number in `text`, commas removed. */
const numbers = (text: string) => (text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => n.replaceAll(",", ""));

describe("required answers", () => {
  it("lists what is missing, by label", () => {
    expect(missingAnswers({})).toContain("Website URL (https://…)");
    expect(missingAnswers(COMPLETE)).toEqual([]);
  });

  it("requires unsubscribe handling only for marketing mail", () => {
    expect(missingAnswers({ ...COMPLETE, mailType: "MARKETING" })).toEqual([
      "Unsubscribe handling (required for marketing mail)",
    ]);
  });

  it("refuses to generate from an incomplete draft", () => {
    expect(() => generateRequest({ ...COMPLETE, bounceHandling: undefined }, NO_FACTS)).toThrow(/Bounce handling/);
  });

  it("rejects a non-URL website", () => {
    expect(missingAnswers({ ...COMPLETE, websiteUrl: "quokka dot example" })).toContain("Website URL (https://…)");
  });
});

describe("no fabrication", () => {
  it("quotes every free-text answer verbatim", () => {
    const text = output(COMPLETE);
    for (const key of ["companyName", "websiteUrl", "useCase", "acquisitionDetails", "bounceHandling", "complaintHandling", "suppressionStrategy"] as const) {
      expect(text).toContain(COMPLETE[key]);
    }
  });

  it("every number in the output is one the user gave (or the region's)", () => {
    const draft: Draft = { ...COMPLETE, monthlyVolume: 38_000, peakRate: 7, requestedDailyQuota: 5_000, requestedRate: 9 };
    const allowed = new Set(["1234", "38000", "7", "5000", "9", "1"]); // "1" from "ap-south-1"
    for (const found of numbers(output(draft))) expect(allowed, `unexpected number ${found}`).toContain(found);
  });

  it("with facts included, the only extra numbers are those facts", () => {
    const draft: Draft = { ...COMPLETE, include: { domains: ["d1"], autoSuppression: true, metrics: true } };
    const allowed = new Set(["1234", "1", "30", "4321", "1.23", "0.04", "2026-09-20".replaceAll("-", "")]);
    for (const found of numbers(output(draft, FACTS)).map((n) => n.replace(/^0+(?=\d)/, ""))) {
      const ok = allowed.has(found) || ["2026", "09", "9", "20"].includes(found);
      expect(ok, `unexpected number ${found}`).toBe(true);
    }
  });

  it("makes no approval, compliance or legal claims the user did not write", () => {
    const text = output({ ...COMPLETE, include: { domains: ["d1"], autoSuppression: true, metrics: true } }, FACTS).toLowerCase();
    for (const claim of ["guarantee", "approved", "approval", "compliant", "compliance", "gdpr", "can-spam", "certified", "100%", "never bounce", "double opt-in"]) {
      expect(text, `fabricated claim: ${claim}`).not.toContain(claim);
    }
  });

  it("repeats a user's own claim only because they wrote it", () => {
    const text = output({ ...COMPLETE, suppressionStrategy: "We are GDPR compliant and honour erasure requests." });
    expect(text).toContain("GDPR compliant");
  });

  it("omits sections for blank answers instead of filling them", () => {
    const text = output(COMPLETE);
    expect(text).not.toContain("Unsubscribe handling");
    expect(text).not.toContain("per month");
    expect(text).not.toContain("per second");
    expect(text).not.toContain("Sending pattern");
    expect(text).not.toContain("Domain authentication");
    expect(text).not.toContain("Recent sending metrics");
    expect(generateRequest(COMPLETE, NO_FACTS).quotaRequest).toBeNull();
  });

  it("states volumes as estimates, never as measurements", () => {
    const text = output(COMPLETE);
    expect(text).toContain("Approximately 1,234 emails per day");
    expect(text).not.toMatch(/we (send|sent|have sent) 1,234/i);
  });

  it("never contains AWS status or outcome language", () => {
    const r = generateRequest({ ...COMPLETE, requestedDailyQuota: 5000 }, FACTS);
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/pending|granted|denied|will be approved|likely/);
  });
});

/**
 * The structural no-fabrication guard.
 *
 * A blocklist of claim words can never be complete (a mutation appending "We
 * follow all applicable email regulations." slipped past one). Instead: fill
 * every answer with a unique placeholder, generate with every option on, and
 * pin the result. What remains is everything the generator itself says —
 * headings, connectors, the labels a user ticked, and the platform facts. Any
 * new sentence, claim or connective changes this skeleton and fails here, so
 * adding one is a deliberate, reviewed change rather than a silent one.
 */
describe("the generator's own words are a closed, reviewed set", () => {
  it("matches the approved skeleton exactly", () => {
    const F = (tag: string, len = 90) => `<${tag}>` + "_".repeat(Math.max(0, len - tag.length - 2));
    const draft: Draft = {
      region: "xx-test-9", mailType: "MARKETING", companyName: F("company", 5), websiteUrl: "https://site.invalid",
      useCase: F("useCase"), emailTypes: ["account_verification", "marketing"], otherEmailTypes: F("otherTypes", 8),
      dailyVolume: 111, monthlyVolume: 222, peakRate: 333, frequency: F("frequency", 8),
      acquisitionMethods: ["signup", "purchased"], acquisitionDetails: F("acquisition"),
      bounceHandling: F("bounce"), complaintHandling: F("complaint"), suppressionStrategy: F("suppression"),
      unsubscribeHandling: F("unsubscribe"), requestedDailyQuota: 444, requestedRate: 555,
      contacts: ["c@site.invalid"], language: "EN", include: { domains: ["d1"], autoSuppression: true, metrics: true },
    };
    const facts: PlatformFacts = {
      domains: [{ id: "d1", domain: "dom.invalid", sesVerified: true, dkim: "DKIMSTATUS", spf: "SPFSTATUS", dmarc: "DMARCSTATUS", dmarcPolicy: "POLICY", checkedAt: "2000-01-02T00:00:00.000Z" }],
      autoSuppressionActive: true,
      metrics: { days: 30, reachedSes: 666, withOutcome: 600, bounceRate: 0.0777, complaintRate: 0.0088, measuredAt: "2000-01-03T00:00:00.000Z" },
    };

    const r = generateRequest(draft, facts);
    let skeleton = `${r.fields.useCaseDescription}\n=====QUOTA=====\n${r.quotaRequest}`;
    for (const [k, v] of Object.entries(draft)) {
      if (typeof v === "string" && v.length > 4 && !["region", "mailType", "language"].includes(k)) {
        skeleton = skeleton.replaceAll(v, `{${k}}`);
      }
    }

    expect(skeleton).toBe(`About us:
{companyName} ({websiteUrl})

Use case:
{useCase}

Emails we will send:
- Account verification / sign-up confirmation
- Marketing and newsletters
- {otherEmailTypes}

Expected volume:
Approximately 111 emails per day, approximately 222 per month, peaking at about 333 per second.
Sending pattern: {frequency}

How recipients are obtained:
- Recipients sign up for an account themselves
- Purchased, rented or third-party lists
{acquisitionDetails}

Bounce handling:
{bounceHandling}
Bounce notifications are delivered to us through Amazon SNS; addresses that hard-bounce are added to a suppression list automatically and are not sent to again.

Complaint handling:
{complaintHandling}
Complaint notifications are delivered through Amazon SNS; complaining addresses are suppressed automatically.

Suppression list:
{suppressionStrategy}

Unsubscribe handling:
{unsubscribeHandling}

Domain authentication:
- dom.invalid: verified in Amazon SES (DKIM DKIMSTATUS); SPF check SPFSTATUS; DMARC check DMARCSTATUS (p=POLICY) — checked 2000-01-02

Recent sending metrics:
Measured by our sending platform over the last 30 days: 666 messages accepted by SES; bounce rate 7.77%; complaint rate 0.88%.
=====QUOTA=====
Region: xx-test-9
Requested sending quota: 444 emails per day
Requested maximum send rate: 555 emails per second
Expected volume: approximately 111 emails per day, peaking at about 333 per second.
Use case: see our production access request for {websiteUrl}.`);
  });
});

describe("platform facts are opt-in and only when true", () => {
  it("cites nothing from the platform unless the user ticks it", () => {
    const text = output(COMPLETE, FACTS);
    expect(text).not.toContain("quokka.example: verified");
    expect(text).not.toContain("Amazon SNS");
    expect(text).not.toContain("4,321");
  });

  it("cites only ticked, SES-verified domains", () => {
    const text = output({ ...COMPLETE, include: { domains: ["d1", "d2"], autoSuppression: false, metrics: false } }, FACTS);
    expect(text).toContain("quokka.example: verified in Amazon SES (DKIM pass); SPF check pass; DMARC check pass (p=quarantine) — checked 2026-09-20");
    expect(text).not.toContain("unverified.example");
  });

  it("the automatic-suppression statement requires both the tick and the fact", () => {
    const ticked = { ...COMPLETE, include: { domains: [], autoSuppression: true, metrics: false } };
    expect(output(ticked, FACTS)).toContain("suppression list automatically");
    expect(output(ticked, { ...FACTS, autoSuppressionActive: false })).not.toContain("Amazon SNS");
  });

  it("metrics require both the tick and a real measurement, and are labelled as measured", () => {
    const ticked = { ...COMPLETE, include: { domains: [], autoSuppression: false, metrics: true } };
    expect(output(ticked, FACTS)).toContain("Measured by our sending platform over the last 30 days: 4,321 messages accepted by SES; bounce rate 1.23%; complaint rate 0.04%.");
    expect(output(ticked, { ...FACTS, metrics: null })).not.toContain("Measured");
  });

  it("every section records its source", () => {
    const r = generateRequest({ ...COMPLETE, include: { domains: ["d1"], autoSuppression: true, metrics: true } }, FACTS);
    for (const s of r.sections) expect(s.source.length).toBeGreaterThan(5);
    expect(r.sections.find((s) => s.heading === "Recent sending metrics")?.source).toMatch(/Platform measurement you included/);
  });
});

describe("the SES request fields", () => {
  it("maps onto PutAccountDetails", () => {
    const r = generateRequest({ ...COMPLETE, contacts: ["ops@quokka.example"], language: "JA" }, NO_FACTS);
    expect(r.fields).toMatchObject({
      mailType: "TRANSACTIONAL",
      websiteUrl: "https://quokka.example",
      contactLanguage: "JA",
      additionalContacts: ["ops@quokka.example"],
    });
  });

  it("the reviewed text changes when any answer changes", () => {
    const a = reviewableText(generateRequest(COMPLETE, NO_FACTS));
    const b = reviewableText(generateRequest({ ...COMPLETE, dailyVolume: 1235 }, NO_FACTS));
    const c = reviewableText(generateRequest({ ...COMPLETE, contacts: ["x@y.example"] }, NO_FACTS));
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("advice (never edits the answers)", () => {
  it("flags purchased lists without hiding the answer", () => {
    const draft: Draft = { ...COMPLETE, acquisitionMethods: ["purchased"] };
    expect(adviceFor(draft, FACTS)[0]).toMatch(/Acceptable Use Policy/);
    expect(output(draft)).toContain("Purchased, rented or third-party lists");
  });

  it("flags missing domain, missing SNS, and an outsized quota", () => {
    const advice = adviceFor({ ...COMPLETE, requestedDailyQuota: 50_000 }, NO_FACTS).join(" ");
    expect(advice).toMatch(/No sending domain is verified/);
    expect(advice).toMatch(/SNS is not connected/);
    expect(advice).toMatch(/over ten times/);
  });
});
