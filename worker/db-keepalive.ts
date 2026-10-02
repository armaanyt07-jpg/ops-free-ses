import { sql } from "drizzle-orm";

import { log } from "@/lib/api/logger";
import { getDb } from "@/db";

/**
 * Keeps one worker database connection warm.
 *
 * The database client closes idle connections after 20 s (`src/db/index.ts`,
 * right for serverless). The worker is a long-lived process whose sends are
 * minutes apart, so every send began by opening a new connection (TCP, TLS,
 * login), about 1.6 s from Railway to Supabase before the first query could
 * run. A trivial query more often than that timeout means the connection is
 * never idle, so a send finds one ready.
 *
 * Self-healing: a failed ping is logged once and the next tick reconnects.
 * It never throws; a database outage is already visible through job failures.
 */
export const DB_KEEPALIVE_INTERVAL_MS = 10_000;

export interface Keepalive {
  stop(): void;
}

export function startDbKeepalive(
  ping: () => Promise<unknown> = () => getDb().execute(sql`select 1`),
  intervalMs: number = DB_KEEPALIVE_INTERVAL_MS,
): Keepalive {
  let failing = false;

  const tick = async (): Promise<void> => {
    try {
      await ping();
      if (failing) {
        failing = false;
        log.info({ event: "worker.db_keepalive_recovered", requestId: "worker" });
      }
    } catch (error) {
      // Log the first failure of a streak, not every 10 s of an outage.
      if (!failing) {
        failing = true;
        log.warn({
          event: "worker.db_keepalive_failed",
          requestId: "worker",
          detail: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();

  return { stop: () => clearInterval(timer) };
}
