import "server-only";

import type { Redis } from "ioredis";

import { log } from "@/lib/api/logger";
import { createRedis, isQueueConfigured } from "@/lib/queue/connection";
import { consumeToken, type RateLimitDecision } from "@/lib/queue/rate-limiter";

/**
 * API abuse protection — Phase 7, SRS §7 ("429 application rate limit
 * exceeded") and §9 ("Rate-limit authentication, API-key creation, domain
 * verification and webhook abuse").
 *
 * Token buckets in Redis (the Phase 2 Lua limiter: atomic, Redis-clock), so
 * limits hold across every app instance.
 *
 * Fails OPEN. If Redis cannot answer within the budget, the request proceeds
 * and the miss is logged. A limiter outage must not become an API outage — and
 * `/send` cannot accept anything without Redis anyway (it answers 503).
 */
export interface LimitPolicy {
  /** Sustained requests per second (fractional allowed). */
  rate: number;
  /** Burst size. */
  burst: number;
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const POLICIES = {
  /** Every public API request, by client IP, before any database work. */
  ip: { rate: num("RATE_LIMIT_IP_PER_SECOND", 20), burst: num("RATE_LIMIT_IP_BURST", 40) },
  /** `POST /api/v1/send`, per API key. */
  apiKey: { rate: num("RATE_LIMIT_KEY_PER_SECOND", 50), burst: num("RATE_LIMIT_KEY_BURST", 100) },
  /** SNS posts from many AWS addresses; generous, but bounded. */
  webhookIp: { rate: 50, burst: 100 },
  /** Dashboard test sends, per tenant: 10 per minute. */
  testSend: { rate: 10 / 60, burst: 5 },
} as const satisfies Record<string, LimitPolicy>;

export type LimitKind = keyof typeof POLICIES;

const BUDGET_MS = 250;

let client: Redis | undefined;
function redis(): Redis {
  client ??= createRedis("queue");
  return client;
}

/** Test hook: point the limiter at a specific connection. */
export function setAbuseRedisForTests(r: Redis | undefined): void {
  client = r;
}

export async function checkLimit(
  kind: LimitKind,
  subject: string,
  requestId = "limit",
): Promise<RateLimitDecision> {
  if (!isQueueConfigured() && !client) return { allowed: true, retryAfterMs: 0 };
  const policy = POLICIES[kind];

  try {
    return await Promise.race([
      consumeToken(redis(), `ratelimit:api:${kind}:${subject}`, policy.rate, policy.burst),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("limiter timeout")), BUDGET_MS)),
    ]);
  } catch (error) {
    log.warn({
      event: "abuse.limiter_unavailable",
      requestId,
      detail: `${kind}: ${error instanceof Error ? error.message : "unknown"}`,
    });
    return { allowed: true, retryAfterMs: 0 };
  }
}

/**
 * The caller's address. Behind Vercel (or any proxy that overwrites it) the
 * first `x-forwarded-for` hop is the client. Directly exposed, the header is
 * caller-controlled — deploy behind a proxy that sets it (see
 * docs/operations/DEPLOYMENT.md).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
