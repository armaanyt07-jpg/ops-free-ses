/**
 * Phase 9: the production-access view. Pure, so every state and every piece of
 * copy is tested directly. The copy tests are the point: this platform must
 * never state or predict an approval (SRS §13), and the one timing statement
 * must be attributed to AWS.
 */
import { describe, expect, it } from "vitest";

import { accessState, describeAccess, inSandbox, type AccessState } from "@/lib/sandbox/access-state";
import type { SesAccountSnapshot } from "@/lib/ses/client";

const snapshot = (over: Partial<SesAccountSnapshot> = {}): SesAccountSnapshot => ({
  productionAccessEnabled: false,
  maxSendRate: 1,
  max24HourSend: 200,
  sentLast24Hours: 0,
  enforcementStatus: "HEALTHY",
  reviewStatus: null,
  reviewCaseId: null,
  ...over,
});

describe("accessState", () => {
  it.each<[string, SesAccountSnapshot | null, boolean, AccessState]>([
    ["no credential", null, false, "not_connected"],
    ["credential never checked", null, true, "unknown"],
    ["production access on", snapshot({ productionAccessEnabled: true }), true, "granted"],
    ["sandbox, never requested", snapshot(), true, "not_requested"],
    ["review pending", snapshot({ reviewStatus: "PENDING" }), true, "pending"],
    ["review denied", snapshot({ reviewStatus: "DENIED" }), true, "denied"],
    ["review failed", snapshot({ reviewStatus: "FAILED" }), true, "failed"],
    ["granted on paper, sandbox limits still reported", snapshot({ reviewStatus: "GRANTED" }), true, "syncing"],
    ["an unrecognised review status", snapshot({ reviewStatus: "SOMETHING_NEW" }), true, "not_requested"],
  ])("%s", (_name, account, connected, expected) => {
    expect(accessState(account, connected)).toBe(expected);
  });

  it("production access wins over a stale review status", () => {
    expect(accessState(snapshot({ productionAccessEnabled: true, reviewStatus: "PENDING" }), true)).toBe("granted");
  });

  it("an unconnected account is not connected even with a leftover snapshot", () => {
    expect(accessState(snapshot(), false)).toBe("not_connected");
  });
});

describe("inSandbox", () => {
  it("is true only where the sandbox still limits sending", () => {
    const limited: AccessState[] = ["not_requested", "pending", "syncing", "denied", "failed"];
    const free: AccessState[] = ["not_connected", "unknown", "granted"];
    for (const s of limited) expect(inSandbox(s)).toBe(true);
    for (const s of free) expect(inSandbox(s)).toBe(false);
  });
});

describe("describeAccess", () => {
  const states: Array<[AccessState, SesAccountSnapshot | null, boolean]> = [
    ["not_connected", null, false],
    ["unknown", null, true],
    ["not_requested", snapshot(), true],
    ["pending", snapshot({ reviewStatus: "PENDING", reviewCaseId: "case-42" }), true],
    ["syncing", snapshot({ reviewStatus: "GRANTED" }), true],
    ["denied", snapshot({ reviewStatus: "DENIED", reviewCaseId: "case-43" }), true],
    ["failed", snapshot({ reviewStatus: "FAILED" }), true],
    ["granted", snapshot({ productionAccessEnabled: true }), true],
  ];

  it.each(states)("%s has a title, a summary and a state that matches", (state, account, connected) => {
    const view = describeAccess(account, { connected });
    expect(view.state).toBe(state);
    expect(view.title.length).toBeGreaterThan(5);
    expect(view.summary.length).toBeGreaterThan(20);
  });

  it("never states or predicts an approval, in any state", () => {
    const forbidden = /guarantee|will be (approved|granted)|likely|certain|soon be|definitely|approved shortly|expect(ed)? approval/i;
    for (const [, account, connected] of states) {
      const view = describeAccess(account, { connected, prepared: true });
      const text = [view.title, view.summary, ...view.canDoNow, view.next?.label ?? ""].join(" ");
      expect(text).not.toMatch(forbidden);
    }
  });

  it("attributes the 24-hour response time to AWS, only on the pending state", () => {
    const pending = describeAccess(snapshot({ reviewStatus: "PENDING" }), { connected: true });
    expect(pending.summary).toMatch(/AWS says/);
    expect(pending.summary).toMatch(/24 hours/);
    expect(pending.summary).toMatch(/longer if it needs more information/);

    for (const [state, account, connected] of states) {
      if (state === "pending") continue;
      expect(describeAccess(account, { connected }).summary).not.toMatch(/24 hours/);
    }
  });

  it("tells a waiting user what works now, with their real limits", () => {
    const view = describeAccess(snapshot({ reviewStatus: "PENDING", max24HourSend: 500, maxSendRate: 3 }), { connected: true });
    expect(view.canDoNow.join(" ")).toContain("500 emails a day, 3 a second");
    expect(view.canDoNow.join(" ")).toContain("simulator.amazonses.com");
  });

  it("falls back to AWS's documented sandbox limits when the snapshot has none", () => {
    const view = describeAccess(snapshot({ max24HourSend: null, maxSendRate: null }), { connected: true });
    expect(view.canDoNow.join(" ")).toContain("200 emails a day, 1 a second");
  });

  it("gives granted accounts nothing to wait for", () => {
    const view = describeAccess(snapshot({ productionAccessEnabled: true }), { connected: true });
    expect(view.canDoNow).toEqual([]);
    expect(view.next).toBeNull();
    expect(view.tone).toBe("success");
  });

  it("carries AWS's case id through, and only when AWS reported one", () => {
    expect(describeAccess(snapshot({ reviewStatus: "DENIED", reviewCaseId: "case-43" }), { connected: true }).caseId).toBe("case-43");
    expect(describeAccess(snapshot(), { connected: true }).caseId).toBeNull();
  });

  it("points a prepared-but-unsubmitted user at the prepared request, not the start", () => {
    const fresh = describeAccess(snapshot(), { connected: true, prepared: false });
    const prepared = describeAccess(snapshot(), { connected: true, prepared: true });
    expect(fresh.next?.href).toBe("/dashboard/sandbox");
    expect(prepared.next?.href).toBe("/dashboard/sandbox#request");
    expect(prepared.summary).toMatch(/doesn't show one yet/);
  });

  it("a denied account is told how to improve, and that AWS may not say why", () => {
    const view = describeAccess(snapshot({ reviewStatus: "DENIED" }), { connected: true });
    expect(view.tone).toBe("problem");
    expect(view.summary).toMatch(/may not give a detailed reason/);
    expect(view.next?.href).toBe("/dashboard/sandbox#questionnaire");
  });

  it("says a pending request can't be edited while AWS reviews it", () => {
    const view = describeAccess(snapshot({ reviewStatus: "PENDING" }), { connected: true });
    expect(view.summary).toMatch(/edit the request while it's under review/);
  });
});
