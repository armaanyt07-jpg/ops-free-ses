import { describe, expect, it } from "vitest";

import {
  analyzeDkim,
  analyzeDmarc,
  analyzeSpf,
  expectedRecords,
  normaliseDomain,
} from "@/lib/dns/checks";
import type { DnsAnswer } from "@/lib/dns/resolver";

/**
 * SRS §10: "detect missing records, malformed values, duplicate SPF records and
 * incorrect DKIM tokens where technically observable." Each is pinned here.
 */
const found = (...records: string[]): DnsAnswer => ({ ok: true, records });
const nothing: DnsAnswer = { ok: true, records: [] };
const timeout: DnsAnswer = { ok: false, error: "ETIMEOUT" };

describe("expectedRecords", () => {
  it("lists three DKIM CNAMEs, then SPF, then DMARC", () => {
    const records = expectedRecords("example.com", ["aaa", "bbb", "ccc"]);
    expect(records.map((r) => `${r.purpose} ${r.type} ${r.name} ${r.value}`)).toEqual([
      "DKIM CNAME aaa._domainkey.example.com aaa.dkim.amazonses.com",
      "DKIM CNAME bbb._domainkey.example.com bbb.dkim.amazonses.com",
      "DKIM CNAME ccc._domainkey.example.com ccc.dkim.amazonses.com",
      "SPF TXT example.com v=spf1 include:amazonses.com ~all",
      "DMARC TXT _dmarc.example.com v=DMARC1; p=none;",
    ]);
  });
});

describe("analyzeSpf", () => {
  it("passes a record that includes amazonses.com", () => {
    const r = analyzeSpf("example.com", found("v=spf1 include:amazonses.com ~all"));
    expect(r.status).toBe("pass");
    expect(r.problems).toEqual([]);
  });

  it("ignores non-SPF TXT records alongside it", () => {
    const r = analyzeSpf(
      "example.com",
      found("google-site-verification=abc", "v=spf1 include:_spf.google.com include:amazonses.com -all"),
    );
    expect(r.status).toBe("pass");
    expect(r.found).toHaveLength(1);
  });

  it("fails when no SPF record exists", () => {
    const r = analyzeSpf("example.com", found("some-other=txt"));
    expect(r.status).toBe("fail");
    expect(r.problems[0]).toMatch(/No SPF record/);
  });

  it("fails on duplicate SPF records, and says why that is fatal", () => {
    const r = analyzeSpf(
      "example.com",
      found("v=spf1 include:amazonses.com ~all", "v=spf1 include:_spf.google.com ~all"),
    );
    expect(r.status).toBe("fail");
    expect(r.problems[0]).toMatch(/2 SPF records/);
    expect(r.problems[0]).toMatch(/RFC 7208/);
  });

  it("fails when SES is not authorized", () => {
    const r = analyzeSpf("example.com", found("v=spf1 include:_spf.google.com ~all"));
    expect(r.status).toBe("fail");
    expect(r.problems[0]).toMatch(/include:amazonses.com/);
  });

  it("warns on +all, and on a bare `all` (which means +all)", () => {
    for (const record of [
      "v=spf1 include:amazonses.com +all",
      "v=spf1 include:amazonses.com all",
    ]) {
      const r = analyzeSpf("example.com", found(record));
      expect(r.status).toBe("warn");
      expect(r.problems[0]).toMatch(/every server/);
    }
  });

  it("does not treat `v=spf10` as an SPF record", () => {
    expect(analyzeSpf("example.com", found("v=spf10 whatever")).status).toBe("fail");
  });

  it("reports a failed lookup as unknown, not as missing", () => {
    const r = analyzeSpf("example.com", timeout);
    expect(r.status).toBe("unknown");
    expect(r.problems[0]).toMatch(/ETIMEOUT/);
  });
});

describe("analyzeDmarc", () => {
  it("passes a valid record and reports its policy", () => {
    const r = analyzeDmarc("example.com", found("v=DMARC1; p=reject; rua=mailto:d@example.com"));
    expect(r.status).toBe("pass");
    expect(r.policy).toBe("reject");
    expect(r.problems).toEqual([]);
  });

  it("passes p=none but suggests tightening it", () => {
    const r = analyzeDmarc("example.com", found("v=DMARC1; p=none"));
    expect(r.status).toBe("pass");
    expect(r.problems[0]).toMatch(/monitoring only/);
  });

  it("fails when missing", () => {
    const r = analyzeDmarc("example.com", nothing);
    expect(r.status).toBe("fail");
    expect(r.problems[0]).toMatch(/_dmarc\.example\.com/);
  });

  it("detects a record published at the doubled name", () => {
    const r = analyzeDmarc("example.com", nothing, found("v=DMARC1; p=none"));
    expect(r.status).toBe("fail");
    expect(r.problems[1]).toMatch(/_dmarc\.example\.com\.example\.com/);
    expect(r.problems[1]).toMatch(/appended the domain/);
  });

  it("fails on multiple records", () => {
    const r = analyzeDmarc("example.com", found("v=DMARC1; p=none", "v=DMARC1; p=reject"));
    expect(r.status).toBe("fail");
    expect(r.problems[0]).toMatch(/2 DMARC records/);
  });

  it("fails a malformed record with no policy tag", () => {
    const r = analyzeDmarc("example.com", found("v=DMARC1; rua=mailto:x@example.com"));
    expect(r.status).toBe("fail");
    expect(r.problems[0]).toMatch(/no `p=`/);
  });

  it("fails an invalid policy value", () => {
    const r = analyzeDmarc("example.com", found("v=DMARC1; p=block"));
    expect(r.status).toBe("fail");
    expect(r.policy).toBe("block");
  });

  it("fails when v=DMARC1 is not the first tag", () => {
    const r = analyzeDmarc("example.com", found("v=DMARC1x; p=none"));
    expect(r.status).toBe("fail");
  });

  it("reports a failed lookup as unknown", () => {
    expect(analyzeDmarc("example.com", timeout).status).toBe("unknown");
  });
});

describe("analyzeDkim", () => {
  const lookups = (answers: DnsAnswer[]) =>
    answers.map((answer, i) => ({ token: `tok${i}`, answer }));

  it("passes when every token resolves to its SES target", () => {
    const r = analyzeDkim(
      "example.com",
      lookups([
        found("tok0.dkim.amazonses.com"),
        // Trailing dots and case are normalised away.
        found("TOK1.dkim.amazonses.com."),
        found("tok2.dkim.amazonses.com"),
      ]),
    );
    expect(r.status).toBe("pass");
    expect(r.problems).toEqual([]);
  });

  it("flags a missing record by name", () => {
    const r = analyzeDkim(
      "example.com",
      lookups([found("tok0.dkim.amazonses.com"), nothing, found("tok2.dkim.amazonses.com")]),
    );
    expect(r.status).toBe("fail");
    expect(r.records[1]?.status).toBe("fail");
    expect(r.problems[0]).toMatch(/^tok1\._domainkey\.example\.com: No CNAME/);
  });

  it("detects an incorrect token — a CNAME pointing at the wrong target", () => {
    const r = analyzeDkim("example.com", lookups([found("tok9.dkim.amazonses.com")]));
    expect(r.status).toBe("fail");
    expect(r.records[0]?.problem).toMatch(/Points to tok9\.dkim\.amazonses\.com/);
    expect(r.records[0]?.problem).toMatch(/token is incorrect/);
  });

  it("detects a record published at the doubled name", () => {
    const r = analyzeDkim("example.com", [
      { token: "tok0", answer: nothing, doubled: found("tok0.dkim.amazonses.com") },
    ]);
    expect(r.status).toBe("fail");
    expect(r.records[0]?.problem).toMatch(
      /tok0\._domainkey\.example\.com\.example\.com/,
    );
  });

  it("is unknown, not fail, when a lookup errors and none are wrong", () => {
    const r = analyzeDkim(
      "example.com",
      lookups([found("tok0.dkim.amazonses.com"), timeout]),
    );
    expect(r.status).toBe("unknown");
  });

  it("is unknown when SES has issued no tokens", () => {
    expect(analyzeDkim("example.com", []).status).toBe("unknown");
  });
});

describe("normaliseDomain", () => {
  it.each([
    ["example.com", "example.com"],
    ["  Mail.Example.COM.  ", "mail.example.com"],
    ["xn--bcher-kva.example", "xn--bcher-kva.example"],
  ])("accepts %j", (input, expected) => {
    expect(normaliseDomain(input)).toBe(expected);
  });

  it.each([
    "",
    "localhost",
    "user@example.com",
    "https://example.com",
    "example.com/path",
    "example..com",
    "-bad.example.com",
    "10.0.0.1",
    `${"a".repeat(64)}.com`,
  ])("rejects %j", (input) => {
    expect(normaliseDomain(input)).toBeNull();
  });
});
