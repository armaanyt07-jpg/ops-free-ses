import type { DnsAnswer } from "./resolver";

/**
 * DNS record expectations and analysis — SRS §10.
 *
 * Pure functions: given what DNS returned, decide pass/fail and say why. The
 * lookups themselves live in `resolver.ts`. Keeping the two apart means every
 * misconfiguration the SRS asks us to detect ("missing records, malformed
 * values, duplicate SPF records and incorrect DKIM tokens") is unit-tested
 * against exact record strings, with no network.
 *
 * Status vocabulary:
 *   pass    — correct
 *   warn    — works, but something should be changed
 *   fail    — missing or wrong
 *   unknown — the lookup itself failed; we cannot say either way
 */
export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface DnsRecord {
  purpose: "DKIM" | "SPF" | "DMARC";
  type: "CNAME" | "TXT";
  /** Fully-qualified name, without the trailing dot. */
  name: string;
  value: string;
}

export const SES_SPF_INCLUDE = "include:amazonses.com";
export const RECOMMENDED_SPF = `v=spf1 ${SES_SPF_INCLUDE} ~all`;

/**
 * A starting DMARC policy. `p=none` only monitors; it is the safe first step,
 * because a stricter policy published before DKIM passes would quarantine the
 * domain's own mail. The dashboard says to tighten it once DKIM is verified.
 */
export const RECOMMENDED_DMARC = "v=DMARC1; p=none;";

export function dkimRecordName(domain: string, token: string): string {
  return `${token}._domainkey.${domain}`;
}

export function dkimRecordTarget(token: string): string {
  return `${token}.dkim.amazonses.com`;
}

export function dmarcRecordName(domain: string): string {
  return `_dmarc.${domain}`;
}

/** The records a user must publish, in the order the dashboard lists them. */
export function expectedRecords(
  domain: string,
  dkimTokens: readonly string[],
): DnsRecord[] {
  return [
    ...dkimTokens.map(
      (token): DnsRecord => ({
        purpose: "DKIM",
        type: "CNAME",
        name: dkimRecordName(domain, token),
        value: dkimRecordTarget(token),
      }),
    ),
    { purpose: "SPF", type: "TXT", name: domain, value: RECOMMENDED_SPF },
    {
      purpose: "DMARC",
      type: "TXT",
      name: dmarcRecordName(domain),
      value: RECOMMENDED_DMARC,
    },
  ];
}

function normaliseHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

// ---------------------------------------------------------------------------
// SPF
// ---------------------------------------------------------------------------

export interface SpfResult {
  status: CheckStatus;
  found: string[];
  problems: string[];
}

export function analyzeSpf(domain: string, answer: DnsAnswer): SpfResult {
  if (!answer.ok) {
    return {
      status: "unknown",
      found: [],
      problems: [`The TXT lookup for ${domain} failed (${answer.error}).`],
    };
  }

  const spf = answer.records.filter((r) => /^v=spf1(\s|$)/i.test(r.trim()));

  if (spf.length === 0) {
    return {
      status: "fail",
      found: [],
      problems: [`No SPF record is published at ${domain}.`],
    };
  }

  if (spf.length > 1) {
    return {
      status: "fail",
      found: spf,
      problems: [
        `${spf.length} SPF records are published at ${domain}. Receivers treat more than one as a permanent error (RFC 7208 §3.2), so SPF fails for every message. Merge them into a single record.`,
      ],
    };
  }

  const record = spf[0]!;
  const terms = record.trim().split(/\s+/).map((t) => t.toLowerCase());
  const problems: string[] = [];
  let status: CheckStatus = "pass";

  if (!terms.includes(SES_SPF_INCLUDE)) {
    status = "fail";
    problems.push(
      `The SPF record does not authorize Amazon SES — \`${SES_SPF_INCLUDE}\` is missing.`,
    );
  }

  if (terms.includes("+all") || terms.includes("all")) {
    status = status === "fail" ? "fail" : "warn";
    problems.push(
      "The record ends in `+all`, which authorizes every server on the internet to send as this domain. Use `~all` or `-all`.",
    );
  }

  return { status, found: spf, problems };
}

// ---------------------------------------------------------------------------
// DMARC
// ---------------------------------------------------------------------------

export interface DmarcResult {
  status: CheckStatus;
  found: string[];
  policy: string | null;
  problems: string[];
}

export function analyzeDmarc(
  domain: string,
  answer: DnsAnswer,
  /** Result of looking up `_dmarc.<domain>.<domain>`, if it was checked. */
  doubled?: DnsAnswer,
): DmarcResult {
  const name = dmarcRecordName(domain);

  if (!answer.ok) {
    return {
      status: "unknown",
      found: [],
      policy: null,
      problems: [`The TXT lookup for ${name} failed (${answer.error}).`],
    };
  }

  const dmarc = answer.records.filter((r) => /^v=DMARC1/i.test(r.trim()));

  if (dmarc.length === 0) {
    const problems = [`No DMARC record is published at ${name}.`];
    if (doubled?.ok && doubled.records.some((r) => /^v=DMARC1/i.test(r))) {
      problems.push(doubledNameHint(`${name}.${domain}`));
    }
    return { status: "fail", found: [], policy: null, problems };
  }

  if (dmarc.length > 1) {
    return {
      status: "fail",
      found: dmarc,
      policy: null,
      problems: [
        `${dmarc.length} DMARC records are published at ${name}. Receivers ignore DMARC entirely when there is more than one (RFC 7489 §6.6.3). Keep exactly one.`,
      ],
    };
  }

  const record = dmarc[0]!;
  const tags = new Map<string, string>();
  for (const part of record.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    tags.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }

  // RFC 7489 §6.4: `v` must be the first tag and `p` must follow it.
  if (!/^v\s*=\s*DMARC1\s*(;|$)/.test(record.trim())) {
    return {
      status: "fail",
      found: dmarc,
      policy: null,
      problems: ["The record must begin with exactly `v=DMARC1;`."],
    };
  }

  const policy = tags.get("p")?.toLowerCase() ?? null;
  if (policy === null) {
    return {
      status: "fail",
      found: dmarc,
      policy: null,
      problems: ["The DMARC record has no `p=` policy tag, so it is invalid."],
    };
  }

  if (!["none", "quarantine", "reject"].includes(policy)) {
    return {
      status: "fail",
      found: dmarc,
      policy,
      problems: [
        `\`p=${policy}\` is not a valid policy. Use none, quarantine or reject.`,
      ],
    };
  }

  return {
    status: "pass",
    found: dmarc,
    policy,
    problems:
      policy === "none"
        ? [
            "Policy is `p=none` (monitoring only). Once DKIM is verified, consider `quarantine` or `reject`.",
          ]
        : [],
  };
}

// ---------------------------------------------------------------------------
// DKIM
// ---------------------------------------------------------------------------

export interface DkimRecordResult {
  name: string;
  expected: string;
  found: string[];
  status: CheckStatus;
  problem: string | null;
}

export interface DkimResult {
  status: CheckStatus;
  records: DkimRecordResult[];
  problems: string[];
}

export interface DkimLookup {
  token: string;
  answer: DnsAnswer;
  /** Result of looking up the name with the domain appended twice. */
  doubled?: DnsAnswer | undefined;
}

function doubledNameHint(name: string): string {
  return `A matching record exists at ${name} — your DNS provider appended the domain a second time. Enter only the host part (everything before your domain) in the name field.`;
}

export function analyzeDkim(domain: string, lookups: DkimLookup[]): DkimResult {
  if (lookups.length === 0) {
    return {
      status: "unknown",
      records: [],
      problems: ["SES has not issued DKIM tokens for this identity yet."],
    };
  }

  const records = lookups.map(({ token, answer, doubled }): DkimRecordResult => {
    const name = dkimRecordName(domain, token);
    const expected = dkimRecordTarget(token);

    if (!answer.ok) {
      return {
        name,
        expected,
        found: [],
        status: "unknown",
        problem: `Lookup failed (${answer.error}).`,
      };
    }

    const found = answer.records.map(normaliseHost);

    if (found.length === 0) {
      const hint =
        doubled?.ok &&
        doubled.records.map(normaliseHost).includes(expected.toLowerCase())
          ? ` ${doubledNameHint(`${name}.${domain}`)}`
          : "";
      return {
        name,
        expected,
        found,
        status: "fail",
        problem: `No CNAME record is published at ${name}.${hint}`,
      };
    }

    if (!found.includes(expected.toLowerCase())) {
      return {
        name,
        expected,
        found,
        status: "fail",
        problem: `Points to ${found.join(", ")} — expected ${expected}. The DKIM token is incorrect; copy the value again from this page.`,
      };
    }

    return { name, expected, found, status: "pass", problem: null };
  });

  const statuses = records.map((r) => r.status);
  const status: CheckStatus = statuses.includes("fail")
    ? "fail"
    : statuses.includes("unknown")
      ? "unknown"
      : "pass";

  return {
    status,
    records,
    problems: records.flatMap((r) =>
      r.problem ? [`${r.name}: ${r.problem}`] : [],
    ),
  };
}

// ---------------------------------------------------------------------------
// Domain names
// ---------------------------------------------------------------------------

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Normalises user input to a bare domain, or returns null if it is not one.
 * Rejects URLs and email addresses explicitly rather than trying to salvage
 * them, so the user sees what they actually typed was wrong.
 */
export function normaliseDomain(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/\.$/, "");

  if (value.length === 0 || value.length > 253) return null;
  if (value.includes("@") || value.includes("/") || value.includes(":")) {
    return null;
  }

  const labels = value.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => LABEL.test(label))) return null;
  // The top-level label is never all-numeric; this also rejects IPv4 input.
  if (/^\d+$/.test(labels[labels.length - 1]!)) return null;

  return value;
}
