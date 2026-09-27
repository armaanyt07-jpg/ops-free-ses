import { Resolver } from "node:dns/promises";

/**
 * DNS lookups for domain verification — SRS FR-2 / §10.
 *
 * The one distinction this module exists to preserve: **a record that does not
 * exist is not the same as a lookup that failed.** NXDOMAIN and NODATA are
 * answers ("nothing is published there") and come back as `ok: true` with no
 * records. A timeout or SERVFAIL is not an answer, and comes back as
 * `ok: false`, so the dashboard says "could not check" instead of telling a
 * user who published everything correctly that their record is missing.
 *
 * Kept behind this small interface so tests substitute it at the module
 * boundary, the same way the SES client is substituted.
 */
export type DnsAnswer =
  | { ok: true; records: string[] }
  | { ok: false; error: string };

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

function resolver(): Resolver {
  // Bounded so a slow authoritative server cannot stall a page action.
  return new Resolver({ timeout: 3_000, tries: 2 });
}

function classify(error: unknown): DnsAnswer {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "UNKNOWN";

  if (NOT_FOUND.has(code)) return { ok: true, records: [] };
  return { ok: false, error: code };
}

/** TXT records, with each record's character-strings joined (RFC 7208 §3.3). */
export async function lookupTxt(name: string): Promise<DnsAnswer> {
  try {
    const chunks = await resolver().resolveTxt(name);
    return { ok: true, records: chunks.map((parts) => parts.join("")) };
  } catch (error) {
    return classify(error);
  }
}

export async function lookupCname(name: string): Promise<DnsAnswer> {
  try {
    return { ok: true, records: await resolver().resolveCname(name) };
  } catch (error) {
    return classify(error);
  }
}
