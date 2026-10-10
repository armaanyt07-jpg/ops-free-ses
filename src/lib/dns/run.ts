import { analyzeDkim, analyzeDmarc, analyzeSpf, dkimRecordName, dmarcRecordName } from "./checks";
import { lookupCname, lookupTxt } from "./resolver";

/**
 * Looks up and analyses a domain's SPF, DMARC and DKIM records. Shared by the
 * dashboard's domain check and the public DNS checker, so both give the same
 * verdicts for the same records.
 */
export async function checkDns(domain: string, tokens: string[]) {
  const dmarcName = dmarcRecordName(domain);

  const [spfAnswer, dmarcAnswer, dkimAnswers] = await Promise.all([
    lookupTxt(domain),
    lookupTxt(dmarcName),
    Promise.all(tokens.map((t) => lookupCname(dkimRecordName(domain, t)))),
  ]);

  // "Detect common DNS errors where observable" (FR-2). The most common one:
  // a DNS provider that appends the zone to whatever is typed as the name,
  // producing `x._domainkey.example.com.example.com`. Only looked for when the
  // correct name is empty, so a healthy domain costs no extra lookups.
  const dkimLookups = await Promise.all(
    tokens.map(async (token, i) => {
      const answer = dkimAnswers[i]!;
      const missing = answer.ok && answer.records.length === 0;
      return {
        token,
        answer,
        doubled: missing
          ? await lookupCname(`${dkimRecordName(domain, token)}.${domain}`)
          : undefined,
      };
    }),
  );

  const dmarcMissing = dmarcAnswer.ok && dmarcAnswer.records.length === 0;
  const dmarcDoubled = dmarcMissing
    ? await lookupTxt(`${dmarcName}.${domain}`)
    : undefined;

  return {
    spf: analyzeSpf(domain, spfAnswer),
    dmarc: analyzeDmarc(domain, dmarcAnswer, dmarcDoubled),
    dkim: analyzeDkim(domain, dkimLookups),
  };
}

