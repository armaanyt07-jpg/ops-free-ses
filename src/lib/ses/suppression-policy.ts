import type { SesEvent } from "./notification";

/**
 * Which SES events suppress a recipient — SRS FR-5 step 6, §11.
 *
 * "Hard bounces and complaints should normally activate suppression.
 * Transient/soft bounce behavior should be policy-driven."
 *
 * The policy, stated in one place:
 *
 *   Permanent bounce   → suppress. The mailbox does not exist or will never
 *                        accept mail; sending again only damages reputation.
 *                        Includes SES's own `OnAccountSuppressionList` subtype.
 *   Complaint          → suppress. The recipient marked the mail as spam.
 *   Transient bounce   → do NOT suppress. Mailbox full, message too large,
 *                        temporary server trouble — SES has already retried,
 *                        and the next message may well be accepted.
 *   Undetermined       → do NOT suppress. SES could not classify it, and
 *                        suppression is not undone automatically, so the
 *                        conservative choice is to keep the address.
 *
 * Changing the soft-bounce behaviour is a change to this object, and the tests
 * pin the current values.
 */
export const SUPPRESSION_POLICY = {
  permanentBounce: true,
  transientBounce: false,
  undeterminedBounce: false,
  complaint: true,
} as const;

/** Values stored in `suppression_list.reason` (varchar 40). */
export type SuppressionReason =
  | "hard_bounce"
  | "soft_bounce"
  | "complaint";

export interface SuppressionDecision {
  email: string;
  reason: SuppressionReason;
}

export function suppressionsFor(event: SesEvent): SuppressionDecision[] {
  if (event.kind === "complaint") {
    return SUPPRESSION_POLICY.complaint
      ? event.recipients.map((email) => ({ email, reason: "complaint" }))
      : [];
  }

  if (event.kind === "bounce") {
    const suppress =
      event.bounceType === "Permanent"
        ? SUPPRESSION_POLICY.permanentBounce
        : event.bounceType === "Transient"
          ? SUPPRESSION_POLICY.transientBounce
          : SUPPRESSION_POLICY.undeterminedBounce;

    if (!suppress) return [];

    const reason: SuppressionReason =
      event.bounceType === "Permanent" ? "hard_bounce" : "soft_bounce";
    return event.recipients.map((r) => ({ email: r.email, reason }));
  }

  return [];
}
