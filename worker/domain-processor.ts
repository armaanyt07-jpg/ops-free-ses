import type { Job } from "bullmq";

import { log } from "@/lib/api/logger";
import type { DomainJobData } from "@/lib/queue/domain-queue";
import { checkDomain } from "@/server/domains";

/**
 * Domain verification poller — SRS FR-2.
 *
 * Each run is one check. While SES still reports the domain as pending, the
 * processor throws, and BullMQ's retry — bounded by `DOMAIN_POLL_ATTEMPTS`,
 * spaced by `domainPollDelayMs` — schedules the next look. A verified or failed
 * domain completes the job; so does one that has been removed.
 */
export class DomainStillPendingError extends Error {
  constructor() {
    super("Domain verification still pending");
    this.name = "DomainStillPendingError";
  }
}

export async function processDomainJob(job: Job<DomainJobData>): Promise<void> {
  const { domainId, userId } = job.data;

  const view = await checkDomain(userId, domainId);

  const fields = {
    event: "worker.domain_checked",
    requestId: "domain",
    userId,
    jobId: job.id,
    attempt: job.attemptsMade + 1,
  };

  if (!view) {
    log.info({ ...fields, detail: "domain_removed" });
    return;
  }

  log.info({ ...fields, environment: view.environment, status: view.status });

  if (view.status === "pending") throw new DomainStillPendingError();
}
