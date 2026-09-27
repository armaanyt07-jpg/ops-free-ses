import { z } from "zod";

/**
 * SES production-access request generator — SRS §13, Phase 6.
 *
 * "The system generates a structured, factual AWS Support request based only
 * on user-provided information. The system MUST NOT fabricate compliance
 * claims, customer information, sending volumes, or AWS approval status."
 *
 * How this module makes that true by construction, rather than by care:
 *
 *   1. Deterministic. No model, no paraphrase: the output is the user's own
 *      answers, verbatim, joined by fixed connecting phrases that assert
 *      nothing ("Expected volume:", "How recipients are obtained:").
 *   2. Omission, never invention. A question left blank produces no section.
 *      There are no defaults that could put words in the user's mouth.
 *   3. Numbers only from the user. Every figure in the output is one the user
 *      typed, or a platform measurement the user explicitly chose to include
 *      (and those are labelled as measurements, with their source and date).
 *   4. Every section records where it came from (`source`), and the review
 *      step shows it, so a human can check each statement against its origin.
 *   5. No status claims. Nothing here says, implies or predicts approval.
 *
 * Pure and dependency-light, so the dashboard previews the exact text the
 * server will record as reviewed.
 */

// ---------------------------------------------------------------------------
// Answers — exactly what the user provides
// ---------------------------------------------------------------------------

export const EMAIL_TYPES = {
  account_verification: "Account verification / sign-up confirmation",
  password_reset: "Password resets and security alerts",
  receipts: "Receipts and order confirmations",
  notifications: "Account and activity notifications",
  reports: "Reports and digests the recipient requested",
  marketing: "Marketing and newsletters",
} as const;

export const ACQUISITION_METHODS = {
  signup: "Recipients sign up for an account themselves",
  double_opt_in: "Recipients confirm their address (double opt-in)",
  checkout: "Recipients provide their address at purchase",
  existing_customers: "Existing customers who provided their address to us",
  purchased: "Purchased, rented or third-party lists",
} as const;

const text = (max: number) => z.string().trim().max(max);
const count = z.coerce.number().int().min(1).max(100_000_000);

/** Lenient: what can be saved as a draft (anything, partially filled). */
export const draftSchema = z
  .object({
    region: text(32),
    mailType: z.enum(["TRANSACTIONAL", "MARKETING"]),
    companyName: text(120),
    websiteUrl: text(500),
    useCase: text(3000),
    emailTypes: z.array(z.enum(Object.keys(EMAIL_TYPES) as [keyof typeof EMAIL_TYPES])),
    otherEmailTypes: text(300),
    dailyVolume: count,
    monthlyVolume: count,
    peakRate: count,
    frequency: text(300),
    acquisitionMethods: z.array(z.enum(Object.keys(ACQUISITION_METHODS) as [keyof typeof ACQUISITION_METHODS])),
    acquisitionDetails: text(2000),
    bounceHandling: text(1500),
    complaintHandling: text(1500),
    suppressionStrategy: text(1500),
    unsubscribeHandling: text(1500),
    requestedDailyQuota: count,
    requestedRate: count,
    contacts: z.array(z.string().trim().email()).max(4),
    language: z.enum(["EN", "JA"]),
    include: z.object({
      domains: z.array(z.string()).max(20),
      autoSuppression: z.boolean(),
      metrics: z.boolean(),
    }),
  })
  .partial();

export type Draft = z.infer<typeof draftSchema>;

/** What each required question needs before a request can be generated. */
export const REQUIRED: Array<{ key: keyof Draft; label: string; check: (d: Draft) => boolean }> = [
  { key: "region", label: "AWS region", check: (d) => Boolean(d.region) },
  { key: "mailType", label: "Mail type", check: (d) => Boolean(d.mailType) },
  { key: "companyName", label: "Company or product name", check: (d) => Boolean(d.companyName) },
  {
    key: "websiteUrl",
    label: "Website URL (https://…)",
    check: (d) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(d.websiteUrl ?? ""),
  },
  { key: "useCase", label: "Use-case description (at least 80 characters)", check: (d) => (d.useCase?.length ?? 0) >= 80 },
  {
    key: "emailTypes",
    label: "At least one kind of email",
    check: (d) => (d.emailTypes?.length ?? 0) > 0 || Boolean(d.otherEmailTypes),
  },
  { key: "dailyVolume", label: "Expected emails per day", check: (d) => Boolean(d.dailyVolume) },
  {
    key: "acquisitionDetails",
    label: "How you obtain recipients (at least 40 characters)",
    check: (d) => (d.acquisitionDetails?.length ?? 0) >= 40,
  },
  { key: "bounceHandling", label: "Bounce handling", check: (d) => (d.bounceHandling?.length ?? 0) >= 20 },
  { key: "complaintHandling", label: "Complaint handling", check: (d) => (d.complaintHandling?.length ?? 0) >= 20 },
  { key: "suppressionStrategy", label: "Suppression strategy", check: (d) => (d.suppressionStrategy?.length ?? 0) >= 20 },
  {
    key: "unsubscribeHandling",
    label: "Unsubscribe handling (required for marketing mail)",
    check: (d) => d.mailType !== "MARKETING" || (d.unsubscribeHandling?.length ?? 0) >= 20,
  },
];

export function missingAnswers(draft: Draft): string[] {
  return REQUIRED.filter((r) => !r.check(draft)).map((r) => r.label);
}

// ---------------------------------------------------------------------------
// Facts from the platform — offered, never assumed
// ---------------------------------------------------------------------------

export interface DomainFact {
  id: string;
  domain: string;
  /** SES's own verification result. Only verified domains are offered. */
  sesVerified: boolean;
  dkim: string;
  spf: string;
  dmarc: string;
  dmarcPolicy: string | null;
  checkedAt: string | null;
}

export interface MetricsFact {
  days: number;
  reachedSes: number;
  withOutcome: number;
  bounceRate: number;
  complaintRate: number;
  measuredAt: string;
}

export interface PlatformFacts {
  domains: DomainFact[];
  /**
   * Offered only when an SNS topic is confirmed, i.e. automatic suppression is
   * actually running. Claiming it otherwise would be false.
   */
  autoSuppressionActive: boolean;
  /**
   * Offered only with SNS confirmed and outcomes recorded. Without SNS, a
   * measured bounce rate reads 0% because nothing is measured — presenting
   * that to AWS would be a fabrication by omission.
   */
  metrics: MetricsFact | null;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface Section {
  heading: string;
  body: string;
  /** Shown in the review step next to the section. */
  source: string;
}

export interface GeneratedRequest {
  /** The five fields of SES `PutAccountDetails` / the console form. */
  fields: {
    mailType: "TRANSACTIONAL" | "MARKETING";
    websiteUrl: string;
    contactLanguage: "EN" | "JA";
    additionalContacts: string[];
    useCaseDescription: string;
  };
  sections: Section[];
  /** Separate Service Quotas / Support text; only if the user asked for a quota. */
  quotaRequest: string | null;
  region: string;
}

/** SES `UseCaseDescription` limit. */
export const USE_CASE_MAX = 5000;

const n = (value: number) => value.toLocaleString("en-US");
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

/**
 * Builds the request from a complete draft. Throws if required answers are
 * missing — callers check `missingAnswers` first; this is the backstop.
 */
export function generateRequest(draft: Draft, facts: PlatformFacts): GeneratedRequest {
  const missing = missingAnswers(draft);
  if (missing.length > 0) throw new Error(`Missing answers: ${missing.join(", ")}`);
  const d = draft as Required<Pick<Draft, "region" | "mailType" | "companyName" | "websiteUrl" | "useCase" | "dailyVolume" | "acquisitionDetails" | "bounceHandling" | "complaintHandling" | "suppressionStrategy">> & Draft;

  const sections: Section[] = [];
  const add = (heading: string, body: string | undefined | null, source: string) => {
    if (body && body.trim()) sections.push({ heading, body: body.trim(), source });
  };

  add("About us", `${d.companyName} (${d.websiteUrl})`, "Your answers: company name, website");
  add("Use case", d.useCase, "Your answer: use case");

  const types = [
    ...(d.emailTypes ?? []).map((t) => EMAIL_TYPES[t]),
    ...(d.otherEmailTypes ? [d.otherEmailTypes] : []),
  ];
  add("Emails we will send", types.map((t) => `- ${t}`).join("\n"), "Your answer: kinds of email");

  const volume = [
    `Approximately ${n(d.dailyVolume)} emails per day`,
    d.monthlyVolume ? `approximately ${n(d.monthlyVolume)} per month` : null,
    d.peakRate ? `peaking at about ${n(d.peakRate)} per second` : null,
  ]
    .filter(Boolean)
    .join(", ");
  add(
    "Expected volume",
    `${volume}.${d.frequency ? `\nSending pattern: ${d.frequency}` : ""}`,
    "Your answers: volume estimates (not measured)",
  );

  const methods = (d.acquisitionMethods ?? []).map((m) => `- ${ACQUISITION_METHODS[m]}`).join("\n");
  add(
    "How recipients are obtained",
    [methods, d.acquisitionDetails].filter(Boolean).join("\n"),
    "Your answers: recipient acquisition",
  );

  const include = d.include ?? { domains: [], autoSuppression: false, metrics: false };

  add(
    "Bounce handling",
    [
      d.bounceHandling,
      include.autoSuppression && facts.autoSuppressionActive
        ? "Bounce notifications are delivered to us through Amazon SNS; addresses that hard-bounce are added to a suppression list automatically and are not sent to again."
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    include.autoSuppression && facts.autoSuppressionActive
      ? "Your answer, plus a platform fact you included: SNS connected, automatic suppression active"
      : "Your answer: bounce handling",
  );
  add(
    "Complaint handling",
    [
      d.complaintHandling,
      include.autoSuppression && facts.autoSuppressionActive
        ? "Complaint notifications are delivered through Amazon SNS; complaining addresses are suppressed automatically."
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    include.autoSuppression && facts.autoSuppressionActive
      ? "Your answer, plus a platform fact you included"
      : "Your answer: complaint handling",
  );
  add("Suppression list", d.suppressionStrategy, "Your answer: suppression strategy");
  add("Unsubscribe handling", d.unsubscribeHandling, "Your answer: unsubscribe handling");

  const domains = facts.domains.filter((f) => f.sesVerified && include.domains.includes(f.id));
  add(
    "Domain authentication",
    domains
      .map(
        (f) =>
          `- ${f.domain}: verified in Amazon SES (DKIM ${f.dkim})` +
          `; SPF check ${f.spf}` +
          `; DMARC check ${f.dmarc}${f.dmarcPolicy ? ` (p=${f.dmarcPolicy})` : ""}` +
          (f.checkedAt ? ` — checked ${f.checkedAt.slice(0, 10)}` : ""),
      )
      .join("\n"),
    "Platform facts you included: SES verification and DNS checks",
  );

  if (include.metrics && facts.metrics) {
    const m = facts.metrics;
    add(
      "Recent sending metrics",
      `Measured by our sending platform over the last ${m.days} days: ${n(m.reachedSes)} messages accepted by SES; ` +
        `bounce rate ${pct(m.bounceRate)}; complaint rate ${pct(m.complaintRate)}.`,
      `Platform measurement you included (as of ${m.measuredAt.slice(0, 10)})`,
    );
  }

  const useCaseDescription = sections.map((s) => `${s.heading}:\n${s.body}`).join("\n\n");

  const quotaRequest =
    d.requestedDailyQuota || d.requestedRate
      ? [
          `Region: ${d.region}`,
          d.requestedDailyQuota ? `Requested sending quota: ${n(d.requestedDailyQuota)} emails per day` : null,
          d.requestedRate ? `Requested maximum send rate: ${n(d.requestedRate)} emails per second` : null,
          `Expected volume: approximately ${n(d.dailyVolume)} emails per day${d.peakRate ? `, peaking at about ${n(d.peakRate)} per second` : ""}.`,
          `Use case: see our production access request for ${d.websiteUrl}.`,
        ]
          .filter(Boolean)
          .join("\n")
      : null;

  return {
    fields: {
      mailType: d.mailType,
      websiteUrl: d.websiteUrl,
      contactLanguage: d.language ?? "EN",
      additionalContacts: d.contacts ?? [],
      useCaseDescription,
    },
    sections,
    quotaRequest,
    region: d.region,
  };
}

/** The exact text a reviewer signs off on — everything that will be submitted. */
export function reviewableText(req: GeneratedRequest): string {
  return JSON.stringify({ fields: req.fields, quotaRequest: req.quotaRequest, region: req.region });
}

// ---------------------------------------------------------------------------
// Advisory warnings — honest guidance, never edits to the user's answers
// ---------------------------------------------------------------------------

export function adviceFor(draft: Draft, facts: PlatformFacts): string[] {
  const advice: string[] = [];

  if (draft.acquisitionMethods?.includes("purchased")) {
    advice.push(
      "You selected purchased, rented or third-party lists. The AWS Acceptable Use Policy prohibits sending to them, and requests that use them are routinely denied. This assistant will not hide or reword that answer.",
    );
  }
  if (draft.mailType === "MARKETING" && !draft.unsubscribeHandling) {
    advice.push("Marketing mail needs a working unsubscribe mechanism; describe yours.");
  }
  if (facts.domains.filter((f) => f.sesVerified).length === 0) {
    advice.push("No sending domain is verified in SES yet. AWS reviewers look for an authenticated domain — verify one on the Domains page first.");
  }
  if (!facts.autoSuppressionActive) {
    advice.push(
      "SNS is not connected, so this platform is not yet receiving bounces and complaints. Describe only the handling you actually have in place.",
    );
  }
  if (draft.requestedDailyQuota && draft.dailyVolume && draft.requestedDailyQuota > draft.dailyVolume * 10) {
    advice.push("The requested daily quota is over ten times your expected daily volume. AWS may ask why; request what you expect to need.");
  }
  if ((draft.useCase?.length ?? 0) > 0 && (draft.useCase?.length ?? 0) < 200) {
    advice.push("Specific use-case descriptions are reviewed more readily — say what triggers each email and who receives it.");
  }
  return advice;
}
