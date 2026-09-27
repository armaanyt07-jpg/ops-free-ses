import { Queue, type JobsOptions } from "bullmq";

import { createRedis } from "./connection";

/**
 * Domain verification polling — SRS FR-2 ("Poll verification state with
 * bounded retries"), §18 ("DNS propagation: clear last-check state and bounded
 * polling").
 *
 * Polling is BullMQ's retry mechanism pointed at a different question: the
 * processor throws while the domain is still pending, and the backoff schedule
 * below decides when to look again. `attempts` is the bound. When it runs out
 * the domain simply stays `pending` with an accurate last-checked time, and
 * "Check now" in the dashboard arms a fresh round.
 *
 * It runs in the worker process rather than the browser, so verification
 * progresses whether or not anyone has the dashboard open.
 */
export const DOMAIN_QUEUE_NAME = "domain-verification";

export interface DomainJobData {
  domainId: string;
  userId: string;
}

export const DOMAIN_POLL_ATTEMPTS = 20;
const FIRST_DELAY_MS = 60_000;
const MAX_DELAY_MS = 2 * 3600 * 1000;

/**
 * 1m, 2m, 4m … doubling to a 2h ceiling. Twenty attempts span roughly 28
 * hours: long enough for someone to add records the next morning, and inside
 * SES's own 72-hour verification window.
 */
export function domainPollDelayMs(attemptsMade: number): number {
  const n = Math.max(1, attemptsMade);
  return Math.min(FIRST_DELAY_MS * 2 ** (n - 1), MAX_DELAY_MS);
}

export const DOMAIN_JOB_OPTIONS: JobsOptions = {
  attempts: DOMAIN_POLL_ATTEMPTS,
  backoff: { type: "domain" },
  // Give the user time to publish records before the first look.
  delay: FIRST_DELAY_MS,
  // Removed on either outcome so the same job id can be armed again later.
  // The domain row holds the durable state; this job is only a timer.
  removeOnComplete: true,
  removeOnFail: true,
};

export function jobIdForDomain(domainId: string): string {
  return `domain-${domainId}`;
}

let queue: Queue<DomainJobData> | undefined;

export function getDomainQueue(): Queue<DomainJobData> {
  if (!queue) {
    queue = new Queue<DomainJobData>(DOMAIN_QUEUE_NAME, {
      connection: createRedis("queue"),
      defaultJobOptions: DOMAIN_JOB_OPTIONS,
    });
  }
  return queue;
}

export async function closeDomainQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
