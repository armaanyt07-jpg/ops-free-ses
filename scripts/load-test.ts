/**
 * Load test for POST /api/v1/send — Phase 7.
 *
 *   npm run load-test -- --url http://localhost:3108 [--total 1500] [--levels 1,10,25]
 *
 * Provisions a throwaway tenant and API key directly in the database, drives
 * the API at each concurrency level, waits for the worker to drain every
 * accepted message to a terminal state, prints and saves the results, and
 * deletes the tenant (cascading every row it created).
 *
 * The tenant has NO AWS credential on purpose: the worker closes each message
 * out as NO_ACTIVE_CREDENTIAL without calling SES, so the run measures the
 * platform (API → Postgres → Redis → worker → Postgres) and sends nothing.
 * Run the target server with raised RATE_LIMIT_* values, or the limiter —
 * correctly — turns the test into a 429 test.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import { config } from "dotenv";

config({ path: ".env.local" });

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1]! : fallback;
};

const URL_ = arg("url", "http://localhost:3108");
const TOTAL = Number(arg("total", "1500"));
const LEVELS = arg("levels", "1,10,25").split(",").map(Number);

function percentile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

void (async () => {
  const { eq, inArray, sql } = await import("drizzle-orm");
  const { getDb } = await import("@/db");
  const { users, emailLogs } = await import("@/db/schema");
  const { createApiKey } = await import("@/server/api-keys");
  const db = getDb();

  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `load-test-${userId.slice(0, 8)}@example.test` });
  const { secret } = await createApiKey(userId, "load-test", "production");
  const results: Record<string, unknown>[] = [];

  try {
    const perLevel = Math.floor(TOTAL / LEVELS.length);
    for (const concurrency of LEVELS) {
      const latencies: number[] = [];
      const statuses = new Map<number, number>();
      let next = 0;
      const started = performance.now();

      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next < perLevel) {
            next += 1;
            const t0 = performance.now();
            const res = await fetch(`${URL_}/api/v1/send`, {
              method: "POST",
              headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
              body: JSON.stringify({ from: "load@example.test", to: ["success@simulator.amazonses.com"], subject: "load", text: "load" }),
            });
            await res.arrayBuffer();
            latencies.push(performance.now() - t0);
            statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
          }
        }),
      );

      const seconds = (performance.now() - started) / 1000;
      latencies.sort((a, b) => a - b);
      const row = {
        concurrency,
        requests: latencies.length,
        seconds: Number(seconds.toFixed(2)),
        throughputPerSecond: Math.round(latencies.length / seconds),
        p50ms: Math.round(percentile(latencies, 50)),
        p95ms: Math.round(percentile(latencies, 95)),
        p99ms: Math.round(percentile(latencies, 99)),
        maxms: Math.round(latencies.at(-1)!),
        statuses: Object.fromEntries(statuses),
      };
      results.push(row);
      console.log(JSON.stringify(row));
    }

    // Drain: every accepted message must reach a terminal state.
    const accepted = results.reduce((n, r) => n + Number((r.statuses as Record<string, number>)["202"] ?? 0), 0);
    const drainStart = Date.now();
    let terminal = 0;
    for (;;) {
      const [row] = await db
        .select({ n: sql<number>`count(*) filter (where ${emailLogs.status} not in ('queued','sending'))` })
        .from(emailLogs)
        .where(eq(emailLogs.userId, userId));
      terminal = Number(row?.n ?? 0);
      if (terminal >= accepted || Date.now() - drainStart > 180_000) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const logs = await db.select({ n: sql<number>`count(*)` }).from(emailLogs).where(eq(emailLogs.userId, userId));
    const drain = {
      accepted,
      logRows: Number(logs[0]?.n ?? 0),
      drainedToTerminal: terminal,
      lost: accepted - terminal,
      drainSeconds: Number(((Date.now() - drainStart) / 1000).toFixed(1)),
    };
    console.log(JSON.stringify({ drain }));

    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/load.json", JSON.stringify({ at: new Date().toISOString(), url: URL_, levels: results, drain }, null, 2));
    void inArray;
  } finally {
    await db.delete(users).where(eq(users.id, userId));
    console.log(JSON.stringify({ cleanup: "load-test tenant and all its rows deleted" }));
    process.exit(0);
  }
})();
