/**
 * The production-access card on the Overview. A problem (AWS denied the
 * request) must be one line there, not a card that pushes the numbers off the
 * screen, while the full detail stays on the pages that show the card in full.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductionAccessCard } from "@/components/dashboard/production-access-card";
import { describeAccess } from "@/lib/sandbox/access-state";

const snapshot = (reviewStatus: string | null) => ({
  productionAccessEnabled: false,
  maxSendRate: 1,
  max24HourSend: 200,
  sentLast24Hours: 0,
  enforcementStatus: "HEALTHY",
  reviewStatus,
  reviewCaseId: reviewStatus ? "179087258700947" : null,
});

const view = (reviewStatus: string | null) => describeAccess(snapshot(reviewStatus), { connected: true, prepared: true });
const html = (v: ReturnType<typeof view>, compact: boolean) =>
  renderToStaticMarkup(createElement(ProductionAccessCard, { view: v, compact }));

describe("a denied request", () => {
  const denied = view("DENIED");

  it("is a single line on the Overview: the title, the status and the way to fix it", () => {
    const out = html(denied, true);
    expect(out).toContain("AWS didn&#x27;t grant production access");
    expect(out).toContain("Needs attention");
    expect(out).toContain("Review your answers");
    // None of the long text that used to push the numbers down.
    expect(out).not.toContain("AWS Support case");
    expect(out).not.toContain("While you wait");
    expect(out).not.toContain("You can reply on the support case");
    // Short enough to be one line: the words you can read, not the markup.
    const text = out.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    expect(text.length).toBeLessThan(110);
  });

  it("keeps the full detail where it has room: the AWS and sandbox pages", () => {
    const out = html(denied, false);
    expect(out).toContain("AWS Support case 179087258700947");
    expect(out).toContain("What you can do right now");
    expect(out).toContain("You can reply on the support case");
  });

  it("still tells assistive tech what state it is in", () => {
    expect(html(denied, true)).toContain('data-access-state="denied"');
  });
});

describe("other states are unchanged on the Overview", () => {
  it("a pending request keeps its summary and the 'while you wait' disclosure", () => {
    const out = html(view("PENDING"), true);
    expect(out).toContain("While you wait: what works");
  });

  it("a plain sandbox account keeps its card", () => {
    const out = html(view(null), true);
    expect(out).toContain("While you wait: what works");
  });
});
