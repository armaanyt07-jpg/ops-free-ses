/**
 * The worker's database keepalive: pings on a timer shorter than the client's
 * idle timeout, survives failures without throwing, and stops cleanly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DB_KEEPALIVE_INTERVAL_MS, startDbKeepalive } from "../../worker/db-keepalive";

vi.mock("@/db", () => ({ getDb: () => ({ execute: async () => [] }) }));

describe("startDbKeepalive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pings straight away, then on every interval", async () => {
    const ping = vi.fn(async () => []);
    const ka = startDbKeepalive(ping, 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(ping).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(ping).toHaveBeenCalledTimes(4);
    ka.stop();
  });

  it("stops pinging after stop()", async () => {
    const ping = vi.fn(async () => []);
    const ka = startDbKeepalive(ping, 1000);
    await vi.advanceTimersByTimeAsync(2000);
    ka.stop();
    const calls = ping.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(ping).toHaveBeenCalledTimes(calls);
  });

  it("survives a failing ping and keeps trying", async () => {
    const ping = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValue([]);
    const ka = startDbKeepalive(ping, 1000);
    await vi.advanceTimersByTimeAsync(2500);
    expect(ping.mock.calls.length).toBeGreaterThanOrEqual(3);
    ka.stop();
  });

  it("pings more often than the client's 20 s idle timeout", () => {
    expect(DB_KEEPALIVE_INTERVAL_MS).toBeLessThan(20_000);
  });
});
