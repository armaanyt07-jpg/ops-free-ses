/**
 * Monthly cost of sending N emails: Ops-Free + Amazon SES, against Resend.
 * Ops-Free is free for everyone for now, so its side is the SES charge alone.
 * Used by the public cost calculator and the comparison blog post, so the
 * numbers can't drift apart.
 *
 * Every rate here is copied from the provider's public pricing page on
 * `PRICES_CHECKED`. When a provider changes its prices, update the table and
 * that date together. Only Resend is compared: its tiers are published as
 * exact numbers. We don't quote anyone whose price we can't state exactly.
 */
export const PRICES_CHECKED = "6 October 2026";

/** Amazon SES outbound, à la carte, per 1,000 emails (aws.amazon.com/ses/pricing). */
export const SES_PER_THOUSAND = 0.1;

export interface ResendTier {
  name: string;
  monthly: number;
  included: number;
  /** Per 1,000 emails past `included`; null where overage isn't offered. */
  overPerThousand: number | null;
}

/** resend.com/pricing, transactional email. */
export const RESEND_TIERS: ResendTier[] = [
  { name: "Free", monthly: 0, included: 3_000, overPerThousand: null },
  { name: "Pro 50k", monthly: 20, included: 50_000, overPerThousand: 0.9 },
  { name: "Pro 100k", monthly: 35, included: 100_000, overPerThousand: 0.9 },
  { name: "Scale 200k", monthly: 160, included: 200_000, overPerThousand: 0.8 },
  { name: "Scale 500k", monthly: 350, included: 500_000, overPerThousand: 0.7 },
  { name: "Scale 1M", monthly: 650, included: 1_000_000, overPerThousand: 0.65 },
  { name: "Scale 1.5M", monthly: 825, included: 1_500_000, overPerThousand: 0.52 },
  { name: "Scale 2.5M", monthly: 1_150, included: 2_500_000, overPerThousand: 0.46 },
];

const cents = (dollars: number) => Math.round(dollars * 100) / 100;

export interface OpsFreeCost {
  opsFree: number;
  ses: number;
  total: number;
}

/** What Amazon bills for the sending. Ops-Free itself costs nothing. */
export function opsFreeCost(emails: number): OpsFreeCost {
  const n = Math.max(0, Math.floor(emails));
  const ses = cents((n / 1000) * SES_PER_THOUSAND);
  return { opsFree: 0, ses, total: ses };
}

export interface ResendCost {
  tier: string;
  total: number;
}

/**
 * The cheapest Resend tier for N emails, overage included. Returns null past
 * the largest published tier's reach (Resend quotes those as Enterprise).
 */
export function resendCost(emails: number): ResendCost | null {
  const n = Math.max(0, Math.floor(emails));
  let best: ResendCost | null = null;
  for (const t of RESEND_TIERS) {
    let total: number;
    if (n <= t.included) total = t.monthly;
    else if (t.overPerThousand === null) continue;
    else total = t.monthly + ((n - t.included) / 1000) * t.overPerThousand;
    total = cents(total);
    if (!best || total < best.total) best = { tier: t.name, total };
  }
  return best;
}

/** Volumes the blog post and the calculator's quick picks use. */
export const SAMPLE_VOLUMES = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

export function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
