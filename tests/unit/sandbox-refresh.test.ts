/**
 * Phase 9: refreshing the sandbox status on page loads. The rules that matter:
 * only while still sandboxed, at most once per cooldown, never slow or fatal
 * for the page, and never touching AWS for an account that already has
 * production access.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CredentialSummary } from "@/server/credentials";
import type { SesAccountSnapshot } from "@/lib/ses/client";

const revalidate = vi.hoisted(() => vi.fn());
vi.mock("@/server/credentials", () => ({ revalidateCredential: revalidate }));

import {
  SANDBOX_REFRESH_COOLDOWN_MS,
  SANDBOX_REFRESH_TIMEOUT_MS,
  needsSandboxRefresh,
  withFreshSandboxStatus,
} from "@/server/sandbox-refresh";

const NOW = Date.parse("2026-10-02T12:00:00Z");

const account = (over: Partial<SesAccountSnapshot> = {}): SesAccountSnapshot => ({
  productionAccessEnabled: false,
  maxSendRate: 1,
  max24HourSend: 200,
  sentLast24Hours: 0,
  enforcementStatus: "HEALTHY",
  reviewStatus: null,
  reviewCaseId: null,
  ...over,
});

const credential = (over: Partial<CredentialSummary> = {}): CredentialSummary => ({
  id: "c1",
  environment: "production",
  accessKeyId: "AKIA…",
  kind: "access_key",
  roleArn: null,
  awsRegion: "ap-south-1",
  sesMaxSendRate: 1,
  active: true,
  lastValidatedAt: new Date(NOW - SANDBOX_REFRESH_COOLDOWN_MS - 1000),
  createdAt: new Date(NOW - 86_400_000),
  account: account(),
  ...over,
});

describe("needsSandboxRefresh", () => {
  it("is due once the snapshot is older than the cooldown", () => {
    expect(needsSandboxRefresh(credential(), NOW)).toBe(true);
  });

  it("is not due inside the cooldown", () => {
    const fresh = credential({ lastValidatedAt: new Date(NOW - SANDBOX_REFRESH_COOLDOWN_MS + 5000) });
    expect(needsSandboxRefresh(fresh, NOW)).toBe(false);
  });

  it("is due exactly at the cooldown boundary", () => {
    const edge = credential({ lastValidatedAt: new Date(NOW - SANDBOX_REFRESH_COOLDOWN_MS) });
    expect(needsSandboxRefresh(edge, NOW)).toBe(true);
  });

  it("is never due once production access is on, however old the snapshot", () => {
    const granted = credential({ account: account({ productionAccessEnabled: true }), lastValidatedAt: new Date(NOW - 30 * 86_400_000) });
    expect(needsSandboxRefresh(granted, NOW)).toBe(false);
  });

  it("is never due for a missing or revoked credential", () => {
    expect(needsSandboxRefresh(undefined, NOW)).toBe(false);
    expect(needsSandboxRefresh(credential({ active: false }), NOW)).toBe(false);
  });

  it("is due when there is no snapshot yet", () => {
    expect(needsSandboxRefresh(credential({ account: null }), NOW)).toBe(true);
  });
});

describe("withFreshSandboxStatus", () => {
  // The code reads the clock; pin it to the same instant the fixtures use.
  beforeEach(() => {
    revalidate.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("returns the credential untouched, without calling AWS, when no refresh is due", async () => {
    const fresh = credential({ lastValidatedAt: new Date() });
    expect(await withFreshSandboxStatus("u1", "production", fresh)).toBe(fresh);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("does not call AWS for an account that already has production access", async () => {
    const granted = credential({ account: account({ productionAccessEnabled: true }) });
    await withFreshSandboxStatus("u1", "production", granted);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("does nothing without a credential", async () => {
    expect(await withFreshSandboxStatus("u1", "production", undefined)).toBeUndefined();
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("returns the refreshed snapshot, scoped to the right tenant and environment", async () => {
    const updated = account({ reviewStatus: "PENDING", reviewCaseId: "case-9" });
    revalidate.mockResolvedValue(updated);
    const result = await withFreshSandboxStatus("u1", "production", credential());
    expect(revalidate).toHaveBeenCalledWith("u1", "production");
    expect(result?.account).toEqual(updated);
    expect(result?.lastValidatedAt!.getTime()).toBe(NOW);
  });

  it("falls back to the old snapshot, quietly, when AWS errors", async () => {
    revalidate.mockRejectedValue(new Error("AccessDenied"));
    const original = credential();
    expect(await withFreshSandboxStatus("u1", "production", original)).toBe(original);
  });

  it("falls back to the old snapshot when there is no credential to revalidate", async () => {
    revalidate.mockResolvedValue(null);
    const original = credential();
    expect(await withFreshSandboxStatus("u1", "production", original)).toBe(original);
  });

  it("never makes the page wait longer than the timeout", async () => {
    revalidate.mockReturnValue(new Promise(() => undefined)); // AWS never answers
    const original = credential();
    const pending = withFreshSandboxStatus("u1", "production", original);
    await vi.advanceTimersByTimeAsync(SANDBOX_REFRESH_TIMEOUT_MS + 1);
    expect(await pending).toBe(original);
  });

  it("the timeout is short enough for a page load", () => {
    expect(SANDBOX_REFRESH_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
  });
});
