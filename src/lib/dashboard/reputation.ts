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

export type ReputationLevel = "none" | "healthy" | "warning" | "review";

export function reputationLevel(
  kind: keyof typeof THRESHOLDS,
  rate: number | null,
): ReputationLevel {
  if (rate === null) return "none";
  const t = THRESHOLDS[kind];
  if (rate >= t.review) return "review";
  if (rate >= t.warning) return "warning";
  return "healthy";
}
