/**
 * Which sidebar items show before and after an account's first send. The
 * Guide link is setup help: new users see it, and it goes away once they've
 * sent something.
 */
import { describe, expect, it } from "vitest";

import { navItemVisible } from "@/components/dashboard/app-nav";

describe("navItemVisible", () => {
  it("setup help (untilFirstSend) shows before the first send and hides after", () => {
    const guide = { untilFirstSend: true };
    expect(navItemVisible(guide, false, false)).toBe(true);
    expect(navItemVisible(guide, true, false)).toBe(false);
  });

  it("day-to-day pages (afterFirstSend) show only after the first send", () => {
    const activity = { afterFirstSend: true };
    expect(navItemVisible(activity, false, false)).toBe(false);
    expect(navItemVisible(activity, true, false)).toBe(true);
  });

  it("plain items are always visible", () => {
    expect(navItemVisible({}, false, false)).toBe(true);
    expect(navItemVisible({}, true, false)).toBe(true);
  });

  it("the page you're on stays visible even when it would be hidden", () => {
    expect(navItemVisible({ afterFirstSend: true }, false, true)).toBe(true);
    expect(navItemVisible({ untilFirstSend: true }, true, true)).toBe(true);
  });
});
