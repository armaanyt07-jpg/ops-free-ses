import { z } from "zod";

/**
 * The symbols Supabase Auth counts for its "lowercase, uppercase letters,
 * digits and symbols" requirement (enabled on the project). Matching its set
 * means the checklist never goes green on a password Supabase then refuses.
 */
const SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

/**
 * What a new password must contain. Shared by the sign-up / reset forms (the
 * live checklist) and the server actions (the check that actually counts).
 * Sign-in does not apply these: accounts made before them still have to work.
 */
export const PASSWORD_RULES = [
  { id: "length", label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { id: "upper", label: "An uppercase letter (A–Z)", test: (p: string) => /[A-Z]/.test(p) },
  { id: "lower", label: "A lowercase letter (a–z)", test: (p: string) => /[a-z]/.test(p) },
  { id: "number", label: "A number (0–9)", test: (p: string) => /[0-9]/.test(p) },
  { id: "symbol", label: "A symbol (e.g. ! @ # $ %)", test: (p: string) => [...p].some((c) => SYMBOLS.includes(c)) },
] as const;

export const NEW_PASSWORD_MESSAGE =
  "Use at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.";

export function passwordMeetsRules(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}

export const newPasswordSchema = z.string().refine(passwordMeetsRules, NEW_PASSWORD_MESSAGE);
