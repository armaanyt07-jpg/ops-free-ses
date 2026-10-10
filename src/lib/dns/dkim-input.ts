/**
 * Reads the DKIM part of the public DNS checker's form. Amazon SES gives each
 * domain three DKIM tokens, and people paste them in whatever shape the SES
 * console showed them: the bare token, the record name
 * (`<token>._domainkey.example.com`) or the target
 * (`<token>.dkim.amazonses.com`). All three come down to the token.
 */
const TOKEN = /^[a-z0-9]{16,64}$/;

export const MAX_DKIM_TOKENS = 3;

export function parseDkimInput(input: string): { tokens: string[]; invalid: string[] } {
  const tokens: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const entry = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!entry) continue;
    const token = entry.split(".")[0]!;
    if (TOKEN.test(token)) {
      if (!tokens.includes(token)) tokens.push(token);
    } else {
      invalid.push(raw.trim());
    }
  }
  return { tokens, invalid };
}
