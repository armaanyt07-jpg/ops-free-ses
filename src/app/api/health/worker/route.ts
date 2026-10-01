import { NextResponse } from "next/server";

import { liveWorkerCount } from "@/server/queue-health";

/**
 * GET /api/health/worker — is any send worker alive? (uptime monitor)
 *
 * `/api/health/ready` proves the app can accept sends; it cannot see the
 * worker, which runs elsewhere (Railway) and is what actually delivers them.
 * A crashed worker leaves the site healthy while the queue silently grows.
 * This route answers from the worker heartbeats (worker/heartbeat.ts): 200
 * while at least one is fresh, 503 when none is, or when Redis cannot be
 * asked within the timeout.
 *
 * Unauthenticated by necessity (uptime probes carry no credentials), so it
 * reveals only a status and a worker count — never error text, hostnames or
 * process ids — and caches its answer for a few seconds.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3_000;
const CACHE_MS = 5_000;

type Body = { status: "ok" | "down" | "unknown"; workers: number };
let cached: { at: number; body: Body } | undefined;

async function check(): Promise<Body> {
  const count = await Promise.race([
    liveWorkerCount(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
  ]);
  if (count === null) return { status: "unknown", workers: 0 };
  return { status: count > 0 ? "ok" : "down", workers: count };
}

export async function GET(): Promise<NextResponse> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), body: await check() };
  }

  return NextResponse.json(cached.body, {
    status: cached.body.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
