import { hostname } from "node:os";
import type { Redis } from "ioredis";

/**
 * Worker health monitoring — Phase 2 scope; surfaced on the System Health
 * screen (SRS §12).
 *
 * Each worker writes a short-lived key and refreshes it on an interval. The
 * key's TTL is the liveness signal: a worker that dies stops refreshing and
 * its record expires on its own, so a crashed instance disappears rather than
 * lingering as a phantom. No cleanup path has to run on the dead process.
 */
export const HEARTBEAT_PREFIX = "worker:heartbeat:";

/** Refresh cadence. The TTL is deliberately longer, to tolerate one miss. */
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_TTL_MS = 35_000;

export interface WorkerHeartbeat {
  workerId: string;
  pid: number;
  host: string;
  concurrency: number;
  startedAt: string;
  beatAt: string;
  processed: number;
  failed: number;
}

export class Heartbeat {
  private timer: NodeJS.Timeout | undefined;
  private processed = 0;
  private failed = 0;
  private readonly startedAt = new Date().toISOString();

  constructor(
    private readonly redis: Redis,
    private readonly workerId: string,
    private readonly concurrency: number,
  ) {}

  get key(): string {
    return `${HEARTBEAT_PREFIX}${this.workerId}`;
  }

  recordProcessed(): void {
    this.processed += 1;
  }

  recordFailed(): void {
    this.failed += 1;
  }

  private payload(): WorkerHeartbeat {
    return {
      workerId: this.workerId,
      pid: process.pid,
      host: hostname(),
      concurrency: this.concurrency,
      startedAt: this.startedAt,
      beatAt: new Date().toISOString(),
      processed: this.processed,
      failed: this.failed,
    };
  }

  async beat(): Promise<void> {
    try {
      await this.redis.set(
        this.key,
        JSON.stringify(this.payload()),
        "PX",
        HEARTBEAT_TTL_MS,
      );
    } catch {
      // A missed beat is not worth crashing the worker over; the TTL will
      // report the worker as unhealthy, which is the correct signal anyway.
    }
  }

  start(): void {
    void this.beat();
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS);
    // Do not hold the event loop open on this timer alone.
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    // Remove the key on a clean shutdown so a deliberately stopped worker is
    // not reported as one that crashed.
    try {
      await this.redis.del(this.key);
    } catch {
      /* the TTL will clear it */
    }
  }
}
