import type { Redis } from "ioredis";

import type { Environment } from "@/db/schema";

/**
 * Distributed SES rate limiter — SRS FR-4.
 *
 * "A distributed limiter shall throttle outgoing SES calls according to the
 * customer's configured SES sending rate. The system must not intentionally
 * exceed the configured provider rate."
 *
 * A token bucket, one per `(tenant, environment)`, held in Redis so the limit
 * holds across every worker process rather than per instance. BullMQ's own
 * worker limiter is deliberately not used: it is global to the queue, so one
 * tenant's quota would throttle every other tenant on the same worker.
 *
 * The whole check-and-consume runs inside a Lua script, which Redis executes
 * atomically. A read-then-write from the client would let two workers observe
 * the same token count and both consume it — exactly the race the limiter
 * exists to prevent.
 *
 * The clock comes from Redis `TIME`, not from the worker. Workers on different
 * machines have skewed clocks, and refill computed against a skewed clock
 * silently grants more tokens than the rate allows.
 */
const SCRIPT = `
local key       = KEYS[1]
local rate      = tonumber(ARGV[1])
local capacity  = tonumber(ARGV[2])
local requested = tonumber(ARGV[3])
local ttl       = tonumber(ARGV[4])

local time = redis.call('TIME')
local now  = (tonumber(time[1]) * 1000) + (tonumber(time[2]) / 1000)

local stored = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(stored[1])
local ts     = tonumber(stored[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end

tokens = math.min(capacity, tokens + (elapsed * rate / 1000.0))

local allowed = 0
local wait = 0

if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  wait = math.ceil(((requested - tokens) * 1000.0) / rate)
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, ttl)

return {allowed, wait}
`;

/** SES sandbox accounts default to 1 message/second. */
export const DEFAULT_SEND_RATE = 1;

const BUCKET_TTL_MS = 5 * 60 * 1000;

export interface RateLimitDecision {
  allowed: boolean;
  /** When not allowed, how long until a token is available. */
  retryAfterMs: number;
}

export function bucketKey(userId: string, environment: Environment): string {
  return `ratelimit:ses:${userId}:${environment}`;
}

interface RedisWithLimiter extends Redis {
  sesTokenBucket?(
    key: string,
    rate: string,
    capacity: string,
    requested: string,
    ttl: string,
  ): Promise<[number, number]>;
}

/** Registers the Lua script on a connection. Idempotent. */
export function registerRateLimiter(redis: Redis): void {
  const client = redis as RedisWithLimiter;
  if (client.sesTokenBucket) return;

  redis.defineCommand("sesTokenBucket", { numberOfKeys: 1, lua: SCRIPT });
}

/**
 * Attempts to consume one token.
 *
 * `maxSendRate` is the tenant's SES quota, as reported by AWS `GetAccount` and
 * stored on the credential. A null or non-positive value falls back to the
 * sandbox default rather than to "unlimited" — guessing high here would mean
 * deliberately exceeding a provider limit, which the SRS forbids.
 */
export async function acquireSendToken(
  redis: Redis,
  userId: string,
  environment: Environment,
  maxSendRate: number | null,
): Promise<RateLimitDecision> {
  registerRateLimiter(redis);

  const rate =
    maxSendRate !== null && maxSendRate > 0 ? maxSendRate : DEFAULT_SEND_RATE;

  // Burst capacity equals one second of throughput: enough to absorb normal
  // arrival jitter, never enough to exceed the per-second rate over any
  // sustained window.
  const capacity = Math.max(1, Math.floor(rate));

  const client = redis as RedisWithLimiter;
  const [allowed, waitMs] = await client.sesTokenBucket!(
    bucketKey(userId, environment),
    String(rate),
    String(capacity),
    "1",
    String(BUCKET_TTL_MS),
  );

  return {
    allowed: allowed === 1,
    // Never return 0 for a denial: a 0ms re-delay would spin.
    retryAfterMs: allowed === 1 ? 0 : Math.max(waitMs, 50),
  };
}

/**
 * The same atomic token bucket, for any key and rate — Phase 7 API abuse
 * protection reuses it rather than adding a second limiter implementation.
 * `ratePerSecond` may be fractional (e.g. 10/minute = 1/6).
 */
export async function consumeToken(
  redis: Redis,
  key: string,
  ratePerSecond: number,
  capacity: number,
): Promise<RateLimitDecision> {
  registerRateLimiter(redis);
  const client = redis as RedisWithLimiter;
  const [allowed, waitMs] = await client.sesTokenBucket!(
    key,
    String(ratePerSecond),
    String(Math.max(1, capacity)),
    "1",
    String(BUCKET_TTL_MS),
  );
  return { allowed: allowed === 1, retryAfterMs: allowed === 1 ? 0 : Math.max(waitMs, 50) };
}
