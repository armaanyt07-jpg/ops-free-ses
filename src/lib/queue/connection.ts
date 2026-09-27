import { Redis, type RedisOptions } from "ioredis";

/**
 * Redis connections for BullMQ — SRS §15 (Upstash as the queue backend).
 *
 * BullMQ needs a real Redis protocol connection, not Upstash's REST API: it
 * relies on blocking reads (`BZPOPMIN`) and ships Lua scripts. Upstash's
 * `rediss://` TCP endpoint supports both; the REST client does not, and cannot
 * be substituted here.
 *
 * Two options are non-negotiable for BullMQ:
 *
 *   maxRetriesPerRequest: null  — BullMQ holds blocking reads open for long
 *     periods. ioredis's default retry cap would abort them mid-flight and
 *     surface as spurious job failures.
 *   enableReadyCheck: false     — Upstash does not implement `INFO` the way
 *     ioredis's ready-probe expects.
 *
 * Connections are created per role rather than shared. A blocking worker
 * connection cannot also serve the queue's non-blocking commands, because the
 * blocking read occupies the socket.
 */
export type RedisRole = "queue" | "worker" | "events" | "util";

export function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL is not set. Expected a Redis protocol URL such as rediss://…upstash.io:6379 (the REST URL will not work with BullMQ).",
    );
  }
  if (!url.startsWith("redis://") && !url.startsWith("rediss://")) {
    throw new Error(
      "REDIS_URL must be a redis:// or rediss:// URL. Upstash's REST endpoint (https://…) is not compatible with BullMQ.",
    );
  }
  return url;
}

/**
 * Connection options differ by role, and the difference matters.
 *
 * `maxRetriesPerRequest: null` means "retry a command forever". BullMQ
 * *requires* it on the connections that hold blocking reads open — a retry cap
 * would abort them mid-flight and surface as spurious job failures.
 *
 * But it is exactly wrong for the producer connection used inside an HTTP
 * request. There, an unreachable Redis would leave `queue.add()` retrying
 * indefinitely and the API hanging instead of answering. The SRS is explicit
 * that an un-enqueueable message gets a prompt 503 (QUEUE_UNAVAILABLE), so the
 * producer gets a bounded retry count and fails fast.
 */
export function connectionOptions(role: RedisRole): RedisOptions {
  const shared: RedisOptions = {
    enableReadyCheck: false,
    // Upstash terminates idle connections; a keepalive avoids paying a
    // reconnect on the first job after a quiet period.
    keepAlive: 30_000,
    connectTimeout: 10_000,
  };

  if (role === "queue") {
    return {
      ...shared,
      maxRetriesPerRequest: 2,
      // Give up reconnecting quickly; `enqueueSend` also races a timeout.
      retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 100, 500)),
    };
  }

  return {
    ...shared,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  };
}

export function createRedis(role: RedisRole): Redis {
  const client = new Redis(redisUrl(), {
    ...connectionOptions(role),
    connectionName: `ops-ses:${role}`,
  });

  // Without a listener, a transient network error becomes an unhandled
  // 'error' event and takes the process down.
  client.on("error", (error: Error) => {
    console.error(
      JSON.stringify({
        level: "error",
        ts: new Date().toISOString(),
        event: "redis.error",
        role,
        detail: error.message,
      }),
    );
  });

  return client;
}

/** True when a queue backend is configured at all. */
export function isQueueConfigured(): boolean {
  return typeof process.env.REDIS_URL === "string" && process.env.REDIS_URL.length > 0;
}
