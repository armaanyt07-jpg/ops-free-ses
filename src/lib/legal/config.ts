/**
 * Facts the Terms and Privacy Policy need that only the operator knows.
 *
 * A value in square brackets is a placeholder. Nothing here is invented: until
 * a placeholder is replaced the pages show a visible "draft" notice listing
 * what is missing, so an unfinished policy can't be mistaken for a final one.
 */
export const LEGAL = {
  product: "Ops-Free SES",
  site: "www.opsfree.in",
  operator: "[OPERATOR: your legal name or company]",
  contactEmail: "support@opsfree.in",
  postalAddress: "[POSTAL ADDRESS]",
  governingLaw: "[GOVERNING LAW AND PLACE OF COURTS]",
  liabilityFloor: "[MINIMUM LIABILITY AMOUNT]",
  deletionTime: "30 days",
  upstashRegion: "Mumbai, India (ap-south-1)",
  signupEmailProvider: "Supabase (its built-in email service)",
  updated: "2 October 2026",
} as const;

export type LegalKey = keyof typeof LEGAL;

const PLACEHOLDER = /^\[.*\]$/;

/** The fields still holding a placeholder. Empty once the policy is complete. */
export function unresolvedLegalFields(values: Record<string, string> = LEGAL): string[] {
  return Object.entries(values)
    .filter(([, v]) => PLACEHOLDER.test(v))
    .map(([k]) => k);
}
