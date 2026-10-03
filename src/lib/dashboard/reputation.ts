/**
 * Sender-reputation thresholds, as AWS applies them to an SES account.
 *
 * SES puts an account under review — and can pause sending — when bounce or
 * complaint rates cross these lines. Showing a rate without them leaves the
 * developer to know by heart that 0.3% complaints is already dangerous.
 *
 * https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html
 */
export const THRESHOLDS = {
  bounce: { warning: 0.05, review: 0.1 },
  complaint: { warning: 0.001, review: 0.005 },
} as const;

/**
 * A rate from a handful of emails says little: one bounce in thirteen sends is
 * "7.7%", in red, after two test sends to the SES simulator. Below this many
 * sends, a rate over the line is shown as "too early" instead of a warning...
 */
export const MIN_SAMPLE = 100;
/** ...unless this many bounces or complaints have actually happened, which is a real signal at any volume. */
export const MIN_EVENTS = 5;

export type ReputationLevel = "none" | "early" | "healthy" | "warning" | "review";

export interface Evidence {
  /** Messages that reached SES: the denominator of the rate. */
  sample: number;
  /** Bounces (for `bounce`) or complaints (for `complaint`) behind the rate. */
  events: number;
}

export function reputationLevel(
  kind: keyof typeof THRESHOLDS,
  rate: number | null,
  evidence?: Evidence,
): ReputationLevel {
  if (rate === null) return "none";
  const t = THRESHOLDS[kind];
  if (evidence && rate >= t.warning && evidence.sample < MIN_SAMPLE && evidence.events < MIN_EVENTS) {
    return "early";
  }
  if (rate >= t.review) return "review";
  if (rate >= t.warning) return "warning";
  return "healthy";
}
