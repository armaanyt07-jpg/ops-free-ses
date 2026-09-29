import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { createRedis, isQueueConfigured } from "@/lib/queue/connection";

/**
 * GET /api/health/ready — readiness (Phase 7 observability).
 *
 * "Can this instance do its job?" — PostgreSQL answers, and Redis (the queue)
 * answers. 200 when both do, 503 otherwise, so a load balancer stops routing
 * sends to an instance that would only answer 503 QUEUE_UNAVAILABLE.
 *
 * Unauthenticated by necessity (platform probes carry no credentials), so it
 * reveals only ok/fail per dependency and its latency — never error text,
 * hostnames or versions — and caches its answer for a few seconds so it
 * cannot be turned into a database load generator.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 2_000;
const CACHE_MS = 5_000;

type Check = { ok: boolean; ms: number };
let cached: { at: number; body: { status: string; checks: Record<string, Check> } } | undefined;

async function timed(fn: () => Promise<unknown>): Promise<Check> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    return { ok: true, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

export async function GET(): Promise<NextResponse> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const [database, queue] = await Promise.all([
      timed(() => getDb().execute(sql`select 1`)),
      isQueueConfigured()
        ? timed(async () => {
            const redis = createRedis("util");
            try {
              await redis.ping();
            } finally {
              redis.disconnect();
            }
          })
        : Promise.resolve({ ok: false, ms: 0 }),
    ]);
    const ok = database.ok && queue.ok;
    cached = { at: Date.now(), body: { status: ok ? "ready" : "degraded", checks: { database, queue } } };
  }

  return NextResponse.json(cached.body, {
    status: cached.body.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
