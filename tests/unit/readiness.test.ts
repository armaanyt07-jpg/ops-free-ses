/**
 * Phase 9: the "Before you submit" checklist. Advisory, so these pin what it
 * may and may not say: never a failure, never a promise, a domain never
 * required, and every item grounded in a fact or the user's own answer.
 */
import { describe, expect, it } from "vitest";

import { readinessItems, readinessSummary, type ReadinessInput } from "@/lib/sandbox/readiness";
import type { Draft, PlatformFacts } from "@/lib/sandbox/request";

const domain = (over: Partial<PlatformFacts["domains"][number]> = {}): PlatformFacts["domains"][number] => ({
  id: "d1",
  domain: "example.com",
  sesVerified: true,
  dkim: "pass",
  spf: "pass",
  dmarc: "pass",
  dmarcPolicy: "quarantine",
  checkedAt: "2026-10-02T00:00:00.000Z",
  ...over,
});

const facts = (over: Partial<PlatformFacts> = {}): PlatformFacts => ({
  domains: [],
  verifiedAddresses: 0,
  autoSuppressionActive: false,
  metrics: null,
  ...over,
});

const complete: Draft = {
  websiteUrl: "https://example.com",
  useCase: "x".repeat(250),
};

const run = (over: Partial<ReadinessInput> = {}) =>
  readinessItems({ draft: complete, facts: facts(), hasSent: true, ...over });

const byId = (items: ReturnType<typeof run>, id: string) => items.find((i) => i.id === id);

describe("readinessItems", () => {
  it("everything in place with a domain, events, a send, a site and a real description", () => {
    const items = run({ facts: facts({ domains: [domain()], autoSuppressionActive: true }) });
    expect(items.every((i) => i.status === "ok")).toBe(true);
    expect(readinessSummary(items)).toEqual({ ok: items.length, consider: 0 });
  });

  describe("sender", () => {
    it("a verified domain is in place", () => {
      expect(byId(run({ facts: facts({ domains: [domain()] }) }), "sender")?.status).toBe("ok");
    });

    it("a verified address alone is in place too: a domain is never required", () => {
      const sender = byId(run({ facts: facts({ verifiedAddresses: 1 }) }), "sender");
      expect(sender?.status).toBe("ok");
      expect(sender?.detail).toMatch(/doesn't need a domain/);
    });

    it("no verified identity at all is worth a look, with somewhere to go", () => {
      const sender = byId(run(), "sender");
      expect(sender?.status).toBe("consider");
      expect(sender?.href).toBe("/dashboard/domains");
    });

    it("attributes the domain advice to AWS's guide rather than asserting it", () => {
      const detail = byId(run({ facts: facts({ domains: [domain()] }) }), "sender")!.detail;
      expect(detail).toMatch(/AWS's guide/);
    });
  });

  describe("authentication", () => {
    it("is skipped when there is no domain, so an address-only user isn't marked down", () => {
      expect(byId(run({ facts: facts({ verifiedAddresses: 1 }) }), "authentication")).toBeUndefined();
    });

    it("passes when DKIM, SPF and DMARC all pass", () => {
      expect(byId(run({ facts: facts({ domains: [domain()] }) }), "authentication")?.status).toBe("ok");
    });

    it.each([["dkim"], ["spf"], ["dmarc"]] as const)("a failing %s is worth a look", (key) => {
      const item = byId(run({ facts: facts({ domains: [domain({ [key]: "fail" })] }) }), "authentication");
      expect(item?.status).toBe("consider");
      expect(item?.detail).toContain("example.com");
    });

    it("an unknown result is not treated as a pass", () => {
      expect(byId(run({ facts: facts({ domains: [domain({ dkim: "unknown" })] }) }), "authentication")?.status).toBe("consider");
    });
  });

  it("events are in place only when automatic suppression is really running", () => {
    expect(byId(run({ facts: facts({ autoSuppressionActive: true }) }), "events")?.status).toBe("ok");
    const off = byId(run(), "events");
    expect(off?.status).toBe("consider");
    expect(off?.detail).toMatch(/describe your own process honestly/);
  });

  it("a test send is in place only when something has been sent", () => {
    expect(byId(run({ hasSent: true }), "sent")?.status).toBe("ok");
    expect(byId(run({ hasSent: false }), "sent")?.status).toBe("consider");
  });

  describe("website", () => {
    it("a valid URL is in place", () => {
      expect(byId(run(), "website")?.status).toBe("ok");
    });

    it.each([[undefined], [""], ["example.com"], ["not a url"]])("%j is worth a look", (url) => {
      const draft: Draft = url === undefined ? { useCase: complete.useCase } : { ...complete, websiteUrl: url };
      expect(byId(run({ draft }), "website")?.status).toBe("consider");
    });
  });

  describe("use case", () => {
    it("200+ characters is in place", () => {
      expect(byId(run({ draft: { ...complete, useCase: "x".repeat(200) } }), "use-case")?.status).toBe("ok");
    });

    it.each([[0], [79], [199]])("%i characters is worth a look", (n) => {
      expect(byId(run({ draft: { ...complete, useCase: "x".repeat(n) } }), "use-case")?.status).toBe("consider");
    });

    it("tells the user to write only what's true", () => {
      const detail = byId(run({ draft: { ...complete, useCase: "short" } }), "use-case")!.detail;
      expect(detail).toMatch(/Only write what's true/);
    });
  });

  describe("permission", () => {
    it("appears only when purchased lists are selected", () => {
      expect(byId(run(), "permission")).toBeUndefined();
      expect(byId(run({ draft: { ...complete, acquisitionMethods: ["signup"] } }), "permission")).toBeUndefined();
      const item = byId(run({ draft: { ...complete, acquisitionMethods: ["purchased"] } }), "permission");
      expect(item?.status).toBe("consider");
      expect(item?.detail).toMatch(/explicitly requested/);
    });
  });

  it("an empty draft and no facts is a list of suggestions, never an error", () => {
    const items = readinessItems({ draft: {}, facts: facts(), hasSent: false });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.status === "ok" || i.status === "consider")).toBe(true);
    expect(readinessSummary(items).consider).toBeGreaterThan(0);
  });

  it("never promises or predicts an outcome, in any item", () => {
    const forbidden = /guarantee|will be (approved|granted)|likely|certain|definitely|ensure|required by AWS/i;
    const inputs: ReadinessInput[] = [
      { draft: {}, facts: facts(), hasSent: false },
      { draft: complete, facts: facts({ domains: [domain({ dkim: "fail" })], autoSuppressionActive: true }), hasSent: true },
      { draft: { ...complete, acquisitionMethods: ["purchased"] }, facts: facts({ verifiedAddresses: 2 }), hasSent: true },
    ];
    for (const input of inputs) {
      for (const item of readinessItems(input)) {
        expect(`${item.label} ${item.detail}`).not.toMatch(forbidden);
      }
    }
  });
});
