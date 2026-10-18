import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Paused mode on, whatever the suite default is.
vi.mock("@/lib/service-status", () => ({
  SERVICE_PAUSED: true,
  PAUSED_MESSAGE: "paused for the test",
}));

const createServerClient = vi.fn();
vi.mock("@supabase/ssr", () => ({ createServerClient }));

const { updateSession } = await import("@/lib/supabase/middleware");
const { withErrorBoundary } = await import("@/lib/api/http");

const req = (path: string) => new NextRequest(new URL(path, "https://www.opsfree.in"));

describe("paused mode", () => {
  it("serves public pages without calling Supabase", async () => {
    for (const path of ["/", "/tools/ses-dns-checker", "/blog", "/login", "/signup"]) {
      const res = await updateSession(req(path));
      expect(res.headers.get("location"), path).toBeNull();
    }
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("sends signed-in pages to /login, which explains the pause", async () => {
    const res = await updateSession(req("/dashboard/logs?x=1"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(new URL(res.headers.get("location")!).search).toBe("");
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("answers the API with 503 and the pause message, without running the handler", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await withErrorBoundary("send", handler)(req("/api/v1/send"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatchObject({
      code: "QUEUE_UNAVAILABLE",
      message: "paused for the test",
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
