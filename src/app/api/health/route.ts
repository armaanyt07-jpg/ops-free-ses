import { NextResponse } from "next/server";

/**
 * GET /api/health — liveness (Phase 7 observability).
 *
 * "Is the process up and serving?" Deliberately touches no dependency, so a
 * database or Redis blip does not make the platform restart healthy app
 * instances. Dependency health is /api/health/ready.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
