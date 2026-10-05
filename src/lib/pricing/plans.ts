/**
 * The plans shown on the landing page and /pricing. One source, so the two
 * can't disagree. Display only: nothing here meters or bills. Paid plans are
 * not open yet (see `PAID_PLANS_OPEN`), and the Terms say the beta is free.
 *
 * Prices are US dollars, per month. Amazon's own SES charges are separate and
 * billed to the customer by AWS.
 */
export type Plan = {
  id: "free" | "pro";
  name: string;
  /** Whole dollars per month. */
  monthly: number;
  blurb: string;
  /** What the quota section of the card says first. */
  emails: string;
  features: string[];
  highlight?: boolean;
};

/** Flip when billing exists. Until then Pro shows "Opens after beta". */
export const PAID_PLANS_OPEN = false;

/** Months billed for a year on annual billing (two months free). */
export const ANNUAL_MONTHS_BILLED = 10;

export const FOUNDING_DISCOUNT_PERCENT = 50;

export const INCLUDED_EVERYWHERE = [
  "One-click AWS setup",
  "Delivery events and the activity log",
  "Automatic suppression of bounces and complaints",
  "API and dashboard",
];

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    monthly: 0,
    blurb: "Everything you need to send your first emails.",
    emails: "3,000 emails / month",
    features: ["1 verified domain or address", "3-day email history", "3 templates"],
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 7,
    blurb: "For a product that sends real traffic.",
    emails: "50,000 emails / month",
    features: ["10 verified domains and addresses", "30-day email history"],
    highlight: true,
  },
];

export function annualPrice(monthly: number): number {
  return monthly * ANNUAL_MONTHS_BILLED;
}
