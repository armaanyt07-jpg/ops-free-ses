import { describe, expect, it } from "vitest";

import {
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
  backoffDelayMs,
  worstCaseTotalDelayMs,
} from "@/lib/queue/retry-policy";

describe("retry policy shape", () => {
  // SRS §8: "5-8 attempts ... capped around 15-30 minutes".
  it("uses an attempt count inside the SRS range", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(5);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(8);
  });

  it("caps a single delay inside the SRS range", () => {
    expect(MAX_DELAY_MS).toBeGreaterThanOrEqual(15 * 60 * 1000);
    expect(MAX_DELAY_MS).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially at the upper bound of the jitter window", () => {
    const ceiling = (n: number) => backoffDelayMs(n, () => 1);

    expect(ceiling(1)).toBe(5_000);
    expect(ceiling(2)).toBe(10_000);
    expect(ceiling(3)).toBe(20_000);
    expect(ceiling(4)).toBe(40_000);
    expect(ceiling(5)).toBe(80_000);
  });

  it("never returns less than the base delay", () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      expect(backoffDelayMs(attempt, () => 0)).toBe(5_000);
    }
  });

  it("never exceeds the cap, however many attempts", () => {
    for (const attempt of [1, 5, 10, 50, 1000]) {
      expect(backoffDelayMs(attempt, () => 1)).toBeLessThanOrEqual(MAX_DELAY_MS);
    }
  });

  /**
   * Full jitter is the point: without it, a provider-wide throttle makes every
   * queued job retry at the same instant and re-trigger the throttle.
   */
  it("spreads retries across the window rather than clustering", () => {
    const samples = new Set(
      Array.from({ length: 200 }, () => backoffDelayMs(4)),
    );
    // Deterministic backoff would collapse to a single value.
    expect(samples.size).toBeGreaterThan(50);
  });

  it("keeps every jittered sample inside [base, exponential]", () => {
    for (let i = 0; i < 500; i += 1) {
      const delay = backoffDelayMs(3);
      expect(delay).toBeGreaterThanOrEqual(5_000);
      expect(delay).toBeLessThanOrEqual(20_000);
    }
  });

  it("handles attempt 0 without going negative", () => {
    expect(backoffDelayMs(0, () => 1)).toBe(5_000);
  });

  // A caller who exhausts retries should have waited long enough for a
  // transient provider outage to clear, but not so long the message is stale.
  it("spans a sensible total window across all retries", () => {
    const totalMinutes = worstCaseTotalDelayMs() / 60_000;
    expect(totalMinutes).toBeGreaterThan(2);
    expect(totalMinutes).toBeLessThan(60);
  });
});
