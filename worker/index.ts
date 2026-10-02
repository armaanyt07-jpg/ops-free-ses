import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { DelayedError, Worker } from "bullmq";
import * as Sentry from "@sentry/node";

config({ path: ".env.local" });

import { log } from "@/lib/api/logger";
import { flushErrors, reportError } from "@/lib/observability/errors";
import { sentryOptions } from "@/lib/observability/sentry";
import { createRedis } from "@/lib/queue/connection";
import {
  DOMAIN_QUEUE_NAME,
  domainPollDelayMs,
  type DomainJobData,
} from "@/lib/queue/domain-queue";
import { backoffDelayMs } from "@/lib/queue/retry-policy";
import { SEND_QUEUE_NAME, type SendJobData } from "@/lib/queue/send-queue";

import { processDomainJob } from "./domain-processor";
import { startDbKeepalive } from "./db-keepalive";
import { Heartbeat } from "./heartbeat";
import { createSendProcessor } from "./processor";

/**
 * SES delivery worker — SRS §15.
 *
 * "Long-lived BullMQ workers should not be treated as ordinary Vercel
 * serverless request handlers. Use a worker runtime compatible with
 * persistent/background processing."
 *
 * A standalone Node process. This is the only place in the system that calls
 * SES, and the only place outside the dashboard that decrypts a customer
 * credential. Run it with `npm run worker`.
 */
// Error monitoring: optional; errors reach Sentry through reportError.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    ...sentryOptions(
      process.env.SENTRY_DSN,
      process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "development",
      process.env.RAILWAY_GIT_COMMIT_SHA,
    ),
    // The process handlers below report through reportError (fingerprinted,
    // redacted); Sentry's own would report every crash a second time.
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== "OnUncaughtException" && i.name !== "OnUnhandledRejection"),
  });
}

const WORKER_ID = process.env.WORKER_ID ?? `w-${randomUUID().slice(0, 8)}`;

const CONCURRENCY = (() => {
  const raw = Number.parseInt(process.env.WORKER_CONCURRENCY ?? "", 10);
  if (Number.isFinite(raw) && raw > 0 && raw <= 100) return raw;
  return 5;
})();

// Three connections by role: the worker's blocking reads occupy their socket,
// so they cannot also serve the limiter's or the heartbeat's commands.
const connection = createRedis("worker");
const utilRedis = createRedis("util");

const heartbeat = new Heartbeat(utilRedis, WORKER_ID, CONCURRENCY);

/*
 * Idle cost. Upstash bills every command, and an idle BullMQ worker is not
 * free: each time its blocking wait for a job times out (`drainDelay`), it
 * sends a BZPOPMIN and a script; each stalled check is another script. With
 * BullMQ's defaults (5 s, 30 s) this process sent 58 commands a minute while
 * idle (measured with MONITOR), about 2.5M a month against the free tier's
 * 500k. The values below bring it to about 5 a minute.
 *
 * A longer `drainDelay` does not slow anything down: adding a job wakes the
 * blocked worker at once. It only sets how often an idle worker re-asks. With
 * delayed jobs pending (retries, domain polls), BullMQ wakes for the next one
 * regardless, capped at 10 s.
 */
const SEND_DRAIN_DELAY_S = 60;
const DOMAIN_DRAIN_DELAY_S = 300;

const worker = new Worker<SendJobData>(
  SEND_QUEUE_NAME,
  createSendProcessor({ redis: utilRedis }),
  {
    connection,
    concurrency: CONCURRENCY,
    // SES calls can be slow; the lock must outlive the call, or a job that is
    // still legitimately running gets treated as stalled.
    lockDuration: 60_000,
    // A job whose worker died is returned to `wait` rather than lost. This is
    // what makes "worker failure does not silently lose accepted jobs" true.
    // Checked every 2 minutes: a crashed send is retried within about 3
    // (this interval plus the lock), at a quarter of the default's cost.
    stalledInterval: 120_000,
    maxStalledCount: 2,
    drainDelay: SEND_DRAIN_DELAY_S,
    settings: {
      backoffStrategy: (attemptsMade: number) => backoffDelayMs(attemptsMade),
    },
  },
);

worker.on("completed", () => heartbeat.recordProcessed());

// Domain verification polling (Phase 3). Its own connection, for the same
// reason as above: a blocking read occupies the socket it runs on. Low
// concurrency — each job is one SES call and a few DNS lookups, and nothing
// about it is latency-sensitive.
const domainConnection = createRedis("worker");

const domainWorker = new Worker<DomainJobData>(
  DOMAIN_QUEUE_NAME,
  processDomainJob,
  {
    connection: domainConnection,
    concurrency: 2,
    lockDuration: 60_000,
    stalledInterval: 300_000,
    drainDelay: DOMAIN_DRAIN_DELAY_S,
    settings: {
      backoffStrategy: (attemptsMade: number) => domainPollDelayMs(attemptsMade),
    },
  },
);

worker.on("failed", (job, error) => {
  if (error instanceof DelayedError) return; // deferred by the limiter, not failed
  heartbeat.recordFailed();
  log.warn({
    event: "worker.job_failed",
    requestId: job?.data.requestId ?? "unknown",
    jobId: job?.id,
    logId: job?.data.logId,
    attempt: job?.attemptsMade,
    detail: error.message.slice(0, 200),
  });
});

worker.on("error", (error) => {
  log.error({ event: "worker.error", requestId: "worker", detail: error.message });
});

// Without a listener an 'error' event would take the whole process down,
// including the send worker.
domainWorker.on("error", (error) => {
  log.error({ event: "worker.domain_error", requestId: "worker", detail: error.message });
});

heartbeat.start();
const dbKeepalive = startDbKeepalive();

log.info({
  event: "worker.started",
  requestId: "worker",
  detail: `id=${WORKER_ID} concurrency=${CONCURRENCY} queues=${SEND_QUEUE_NAME},${DOMAIN_QUEUE_NAME}`,
});

/**
 * Graceful shutdown.
 *
 * `worker.close()` stops accepting new jobs and waits for in-flight ones, so a
 * deploy does not abandon a job mid-SES-call. Anything still running when the
 * platform's grace period expires is recovered by stalled-job detection.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info({ event: "worker.shutdown", requestId: "worker", detail: signal });

  try {
    dbKeepalive.stop();
    await Promise.all([worker.close(), domainWorker.close()]);
    await heartbeat.stop();
    await connection.quit();
    await domainConnection.quit();
    await utilRedis.quit();
  } catch (error) {
    log.error({
      event: "worker.shutdown_error",
      requestId: "worker",
      detail: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    await flushErrors();
    process.exit(0);
  }
}

// Error monitoring (Phase 7). A stray rejection is reported and survived; an
// uncaught exception leaves the process in an unknown state, so it is reported
// and the process exits for the supervisor to restart it — in-flight jobs are
// recovered by stalled-job detection, as for any crash.
process.on("unhandledRejection", (reason) => {
  reportError(reason, { source: "process" });
});
process.on("uncaughtException", (error) => {
  reportError(error, { source: "process" });
  // Bounded: the report gets two seconds to leave before the restart.
  void flushErrors().finally(() => process.exit(1));
});
worker.on("failed", (job, error) => {
  // Expected failures (SES rejections, retries) are logged by the processor.
  // Only errors it did not anticipate reach monitoring.
  if (error && !["UnrecoverableError", "DelayedError", "DomainStillPendingError"].includes(error.name) && !("$metadata" in error)) {
    reportError(error, { source: "worker", jobId: job?.id });
  }
});

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
