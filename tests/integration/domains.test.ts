import { Queue, QueueEvents, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { snsTopics, verifiedDomains } from "@/db/schema";
import type { DnsAnswer } from "@/lib/dns/resolver";
import type { DomainJobData } from "@/lib/queue/domain-queue";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Domain onboarding and verification — SRS FR-2, §7, §10.
 *
 * Real repositories, real PostgreSQL, real BullMQ polling. SES is mocked at the
 * client boundary and DNS at the resolver boundary, with an in-memory zone the
 * tests publish records into — so each test states exactly what DNS holds.
 */
const ses = vi.hoisted(() => ({
  createDomainIdentity: vi.fn(),
  getDomainIdentity: vi.fn(),
  describeSesAccount: vi.fn(),
  sendViaSes: vi.fn(),
  createSesClient: vi.fn(),
}));
vi.mock("@/lib/ses/client", () => ses);

// Phase 8 automation, mocked at the AWS boundary like SES.
const route53 = vi.hoisted(() => ({
  publishDkimRecords: vi.fn(async () => ({ status: "no_zone" }) as const),
}));
vi.mock("@/lib/aws/route53", () => route53);
const events = vi.hoisted(() => ({ attachConfigurationSet: vi.fn(async () => undefined) }));
vi.mock("@/lib/aws/events", () => events);

const zone = vi.hoisted(() => ({
  txt: new Map<string, string[]>(),
  cname: new Map<string, string[]>(),
  failing: new Set<string>(),
}));
vi.mock("@/lib/dns/resolver", () => {
  const lookup =
    (records: Map<string, string[]>) =>
    async (name: string): Promise<DnsAnswer> =>
      zone.failing.has(name)
        ? { ok: false, error: "ETIMEOUT" }
        : { ok: true, records: records.get(name) ?? [] };
  return { lookupTxt: lookup(zone.txt), lookupCname: lookup(zone.cname) };
});

let redis: TestRedis;

beforeAll(async () => {
  redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
}, 30_000);

const { NextRequest } = await import("next/server");
const { GET } = await import("@/app/api/v1/domains/verify/route");
const domains = await import("@/server/domains");
const { storeCredential } = await import("@/server/credentials");
const { createApiKey } = await import("@/server/api-keys");
const { getDomainQueue, closeDomainQueue, jobIdForDomain, DOMAIN_QUEUE_NAME } =
  await import("@/lib/queue/domain-queue");
const { processDomainJob, DomainStillPendingError } = await import(
  "../../worker/domain-processor"
);

const TOKENS = ["tokaaa", "tokbbb", "tokccc"];

function identity(
  verificationStatus: string,
  { tokens = TOKENS, verified = verificationStatus === "SUCCESS" } = {},
) {
  return {
    verificationStatus,
    dkimStatus: verificationStatus,
    dkimTokens: tokens,
    verifiedForSending: verified,
  };
}

function awsError(name: string) {
  return Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode: 400 },
  });
}

function publishAll(domain: string, tokens = TOKENS) {
  for (const t of tokens) {
    zone.cname.set(`${t}._domainkey.${domain}`, [`${t}.dkim.amazonses.com`]);
  }
  zone.txt.set(domain, ["v=spf1 include:amazonses.com ~all"]);
  zone.txt.set(`_dmarc.${domain}`, ["v=DMARC1; p=quarantine"]);
}

let userId: string;

async function addCredential(owner: string, region = "us-east-1", environment: "production" | "staging" = "production") {
  await storeCredential({
    userId: owner,
    environment,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    awsRegion: region,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  zone.txt.clear();
  zone.cname.clear();
  zone.failing.clear();
  process.env.REDIS_URL = redis.url;

  ses.describeSesAccount.mockResolvedValue({
    productionAccessEnabled: true,
    maxSendRate: 14,
    max24HourSend: 50_000,
    sentLast24Hours: 0,
    enforcementStatus: "HEALTHY",
  });
  ses.createDomainIdentity.mockResolvedValue(identity("PENDING"));
  ses.getDomainIdentity.mockResolvedValue(identity("PENDING"));

  await redis.flush();
  await resetTestDb();
  userId = await createTestUser();
  await addCredential(userId);
});

afterAll(async () => {
  await closeDomainQueue().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

describe("onboarding", () => {
  it("creates the SES identity and returns the records to publish", async () => {
    const view = await domains.onboardDomain({
      userId,
      environment: "production",
      domain: "Example.COM",
    });

    expect(ses.createDomainIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ region: "us-east-1" }),
      "example.com",
    );
    expect(view).toMatchObject({
      domain: "example.com",
      environment: "production",
      region: "us-east-1",
      status: "pending",
    });
    expect(view.records.map((r) => r.name)).toEqual([
      "tokaaa._domainkey.example.com",
      "tokbbb._domainkey.example.com",
      "tokccc._domainkey.example.com",
      "example.com",
      "_dmarc.example.com",
    ]);
  });

  it("checks straight away, so the checklist reflects real DNS", async () => {
    const view = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });

    expect(view.lastCheckedAt).toBeInstanceOf(Date);
    expect(view.check).toMatchObject({
      status: "pending",
      sesIdentity: { status: "pending" },
      dkim: { status: "fail" },
      spf: { status: "fail" },
      dmarc: { status: "fail" },
    });
  });

  it("arms background polling for a pending domain", async () => {
    const view = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });

    const job = await getDomainQueue().getJob(jobIdForDomain(view.id));
    expect(job?.data).toEqual({ domainId: view.id, userId });
    expect(await job?.getState()).toBe("delayed");
  });

  it("adopts an identity that already exists in SES", async () => {
    ses.createDomainIdentity.mockRejectedValue(awsError("AlreadyExistsException"));
    ses.getDomainIdentity.mockResolvedValue(identity("SUCCESS"));

    const view = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });

    expect(view.status).toBe("verified");
    expect(await getDomainQueue().getJob(jobIdForDomain(view.id))).toBeUndefined();
  });

  it("requires a credential for that environment", async () => {
    await expect(
      domains.onboardDomain({ userId, environment: "staging", domain: "example.com" }),
    ).rejects.toThrow(/AWS credential for staging/);
    expect(ses.createDomainIdentity).not.toHaveBeenCalled();
  });

  it.each(["https://example.com", "me@example.com", "localhost", ""])(
    "rejects %j before calling SES",
    async (domain) => {
      await expect(
        domains.onboardDomain({ userId, environment: "production", domain }),
      ).rejects.toBeInstanceOf(domains.DomainError);
      expect(ses.createDomainIdentity).not.toHaveBeenCalled();
    },
  );

  it("surfaces an SES refusal as a readable error and stores nothing", async () => {
    ses.createDomainIdentity.mockRejectedValue(awsError("AccessDeniedException"));

    await expect(
      domains.onboardDomain({ userId, environment: "production", domain: "example.com" }),
    ).rejects.toThrow(/SES would not create the identity: AWS rejected the stored credential/);
    expect(await domains.listDomains(userId)).toHaveLength(0);
  });

  it("publishes the DKIM records to Route 53 when it can (Phase 8)", async () => {
    route53.publishDkimRecords.mockResolvedValueOnce({ status: "published", zone: "example.com" } as never);

    const view = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });

    expect(route53.publishDkimRecords).toHaveBeenCalledWith(
      expect.objectContaining({ region: "us-east-1" }),
      "example.com",
      ["tokaaa", "tokbbb", "tokccc"],
    );
    expect(view.autoDns).toEqual({ status: "published", zone: "example.com" });
  });

  it("falls back to manual DNS when Route 53 can't be used", async () => {
    route53.publishDkimRecords.mockResolvedValueOnce({ status: "denied" } as never);
    const view = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    expect(view.autoDns.status).toBe("denied");
    expect(view.status).toBe("pending");
    expect(view.records).toHaveLength(5);
  });

  it("does not touch DNS for an identity SES already verified", async () => {
    ses.createDomainIdentity.mockRejectedValue(awsError("AlreadyExistsException"));
    ses.getDomainIdentity.mockResolvedValue(identity("SUCCESS"));
    await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    expect(route53.publishDkimRecords).not.toHaveBeenCalled();
  });

  it("applies the events configuration set only once events are connected", async () => {
    await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    expect(events.attachConfigurationSet).not.toHaveBeenCalled();

    await getDb().insert(snsTopics).values({
      userId,
      topicArn: "arn:aws:sns:us-east-1:123456789012:ops-free-ses-events",
      managed: true,
      environment: "production",
    });
    await domains.onboardDomain({ userId, environment: "production", domain: "second.example.com" });
    expect(events.attachConfigurationSet).toHaveBeenCalledWith(
      expect.objectContaining({ region: "us-east-1" }),
      "second.example.com",
    );
  });

  it("still adds the domain when applying the configuration set fails", async () => {
    await getDb().insert(snsTopics).values({
      userId,
      topicArn: "arn:aws:sns:us-east-1:123456789012:ops-free-ses-events",
      managed: true,
      environment: "production",
    });
    events.attachConfigurationSet.mockRejectedValueOnce(awsError("AccessDeniedException"));
    const view = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    expect(view.domain).toBe("example.com");
  });

  it("keeps staging and production separate", async () => {
    await addCredential(userId, "eu-west-1", "staging");
    await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    await domains.onboardDomain({ userId, environment: "staging", domain: "example.com" });

    const list = await domains.listDomains(userId);
    expect(list.map((d) => `${d.environment}:${d.region}`).sort()).toEqual([
      "production:us-east-1",
      "staging:eu-west-1",
    ]);
  });
});

describe("checking", () => {
  async function onboard() {
    return domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
  }

  it("passes every DNS check once records are published, while SES is still pending", async () => {
    const { id } = await onboard();
    publishAll("example.com");

    const view = (await domains.checkDomain(userId, id))!;

    expect(view.status).toBe("pending");
    expect(view.check).toMatchObject({
      dkim: { status: "pass" },
      spf: { status: "pass" },
      dmarc: { status: "pass", policy: "quarantine" },
    });
  });

  it("reports verified only when SES says so", async () => {
    const { id } = await onboard();
    publishAll("example.com");
    ses.getDomainIdentity.mockResolvedValue(identity("SUCCESS"));

    const view = (await domains.checkDomain(userId, id))!;
    expect(view.status).toBe("verified");
    expect(view.check?.sesIdentity).toMatchObject({ status: "verified", verificationStatus: "SUCCESS" });
  });

  it("reports failed when SES gives up", async () => {
    const { id } = await onboard();
    ses.getDomainIdentity.mockResolvedValue(identity("FAILED"));

    const view = (await domains.checkDomain(userId, id))!;
    expect(view.status).toBe("failed");
    expect(view.check?.sesIdentity.detail).toMatch(/72 hours/);
  });

  it("reports failed when the identity was deleted in AWS", async () => {
    const { id } = await onboard();
    ses.getDomainIdentity.mockRejectedValue(awsError("NotFoundException"));

    const view = (await domains.checkDomain(userId, id))!;
    expect(view.status).toBe("failed");
    expect(view.check?.sesIdentity.status).toBe("not_found");
  });

  it("keeps the last known status when SES is unreachable", async () => {
    const { id } = await onboard();
    ses.getDomainIdentity.mockResolvedValue(identity("SUCCESS"));
    await domains.checkDomain(userId, id);

    ses.getDomainIdentity.mockRejectedValue(
      Object.assign(new Error("socket hang up"), { name: "TimeoutError" }),
    );
    const view = (await domains.checkDomain(userId, id))!;

    expect(view.status).toBe("verified");
    expect(view.check?.sesIdentity.status).toBe("unavailable");
  });

  it("does not query the wrong region after the credential moves", async () => {
    const { id } = await onboard();
    await addCredential(userId, "eu-west-1");

    const view = (await domains.checkDomain(userId, id))!;

    expect(ses.getDomainIdentity).toHaveBeenCalledTimes(1); // the onboarding check only
    expect(view.check?.sesIdentity.status).toBe("unavailable");
    expect(view.check?.sesIdentity.detail).toMatch(/created in us-east-1.*now points at eu-west-1/);
  });

  it("reports a DNS timeout as unknown, not as a missing record", async () => {
    const { id } = await onboard();
    zone.failing.add("example.com");

    const view = (await domains.checkDomain(userId, id))!;
    expect(view.check?.spf.status).toBe("unknown");
  });

  it("detects records published at the doubled name", async () => {
    const { id } = await onboard();
    zone.cname.set("tokaaa._domainkey.example.com.example.com", ["tokaaa.dkim.amazonses.com"]);

    const view = (await domains.checkDomain(userId, id))!;
    expect(view.check?.dkim.records[0]?.problem).toMatch(/appended the domain/);
  });

  it("follows SES when the DKIM tokens change", async () => {
    const { id } = await onboard();
    ses.getDomainIdentity.mockResolvedValue(identity("PENDING", { tokens: ["new1", "new2", "new3"] }));

    const view = (await domains.checkDomain(userId, id))!;
    expect(view.records[0]?.name).toBe("new1._domainkey.example.com");
  });

  it("rate-limits re-checks with a cooldown", async () => {
    const { id } = await onboard();
    ses.getDomainIdentity.mockClear();

    const first = await domains.checkDomainIfStale(userId, id);
    expect(first?.fresh).toBe(false); // the onboarding check is still fresh
    expect(ses.getDomainIdentity).not.toHaveBeenCalled();

    await getDb()
      .update(verifiedDomains)
      .set({ lastCheckedAt: new Date(Date.now() - domains.CHECK_COOLDOWN_MS - 1) });

    const second = await domains.checkDomainIfStale(userId, id);
    expect(second?.fresh).toBe(true);
    expect(ses.getDomainIdentity).toHaveBeenCalledTimes(1);
  });
});

describe("tenant isolation", () => {
  it("one tenant cannot check, see or remove another's domain", async () => {
    const { id } = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    const intruder = await createTestUser();

    expect(await domains.checkDomain(intruder, id)).toBeNull();
    expect(await domains.checkDomainIfStale(intruder, id)).toBeNull();
    expect(await domains.listDomains(intruder)).toEqual([]);
    expect(await domains.findDomain(intruder, "example.com", "production")).toBeNull();
    expect(await domains.removeDomain(intruder, id)).toBe(false);
    expect(await domains.listDomains(userId)).toHaveLength(1);
  });
});

describe("GET /api/v1/domains/verify", () => {
  let key: string;

  beforeEach(async () => {
    key = (await createApiKey(userId, "ci", "production")).secret;
  });

  function get(query: string, bearer: string | null = key) {
    return GET(
      new NextRequest(`https://app.test/api/v1/domains/verify?${query}`, {
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      }),
    );
  }

  it("requires an API key", async () => {
    expect((await get("domain=example.com", null)).status).toBe(401);
  });

  it("returns the SRS §7 shape", async () => {
    await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    publishAll("example.com");
    ses.getDomainIdentity.mockResolvedValue(identity("SUCCESS"));
    await getDb()
      .update(verifiedDomains)
      .set({ lastCheckedAt: new Date(0) }); // force a fresh check

    const res = await get("domain=example.com&environment=production");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      domain: "example.com",
      environment: "production",
      status: "verified",
      checks: {
        sesIdentity: "verified",
        spf: { status: "pass" },
        dkim: { status: "pass" },
        dmarc: { status: "pass" },
      },
    });
    expect(new Date(body.checkedAt).getTime()).toBeGreaterThan(0);
    expect(body.records).toHaveLength(5);
  });

  it("defaults the environment to the key's", async () => {
    await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    expect((await get("domain=example.com")).status).toBe(200);
  });

  it("refuses to read another environment's domain", async () => {
    const res = await get("domain=example.com&environment=staging");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/scoped to production/);
  });

  it("answers DOMAIN_NOT_VERIFIED for a domain that was never added", async () => {
    const res = await get("domain=unknown.com");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("DOMAIN_NOT_VERIFIED");
  });

  it("cannot see another tenant's domain", async () => {
    const other = await createTestUser();
    await addCredential(other);
    await domains.onboardDomain({ userId: other, environment: "production", domain: "theirs.com" });

    expect((await get("domain=theirs.com")).status).toBe(403);
  });

  it("requires the domain parameter", async () => {
    expect((await get("")).status).toBe(400);
  });
});

describe("background polling", () => {
  it("the processor throws while pending and returns once verified", async () => {
    const { id } = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    const job = { id: "j", attemptsMade: 0, data: { domainId: id, userId } } as never;

    await expect(processDomainJob(job)).rejects.toBeInstanceOf(DomainStillPendingError);

    ses.getDomainIdentity.mockResolvedValue(identity("SUCCESS"));
    await expect(processDomainJob(job)).resolves.toBeUndefined();
  });

  it("completes quietly for a domain that was removed", async () => {
    const { id } = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    await domains.removeDomain(userId, id);

    const job = { id: "j", attemptsMade: 0, data: { domainId: id, userId } } as never;
    await expect(processDomainJob(job)).resolves.toBeUndefined();
  });

  it("re-arming while a round is in flight does not add a second job", async () => {
    const view = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    await domains.scheduleDomainPolling({ id: view.id, userId });
    await domains.scheduleDomainPolling({ id: view.id, userId });

    const counts = await getDomainQueue().getJobCounts("delayed", "waiting");
    expect((counts.delayed ?? 0) + (counts.waiting ?? 0)).toBe(1);
  });

  /** Drives the real BullMQ retry loop with millisecond backoff. */
  async function runPoller(attempts: number) {
    const { id } = await domains.onboardDomain({ userId, environment: "production", domain: "example.com" });
    await getDomainQueue().obliterate({ force: true });

    const queue = new Queue<DomainJobData>(DOMAIN_QUEUE_NAME, {
      connection: { host: "127.0.0.1", port: redis.port },
    });
    const worker = new Worker<DomainJobData>(DOMAIN_QUEUE_NAME, processDomainJob, {
      connection: { host: "127.0.0.1", port: redis.port },
      settings: { backoffStrategy: () => 10 },
    });

    const job = await queue.add(
      "poll",
      { domainId: id, userId },
      { attempts, backoff: { type: "domain" } },
    );
    return { id, job, queue, worker };
  }

  it("keeps polling until SES verifies the domain", async () => {
    ses.getDomainIdentity
      .mockResolvedValueOnce(identity("PENDING")) // onboarding check
      .mockResolvedValueOnce(identity("PENDING"))
      .mockResolvedValueOnce(identity("PENDING"))
      .mockResolvedValue(identity("SUCCESS"));

    const { id, job, queue, worker } = await runPoller(10);
    const events = new QueueEvents(DOMAIN_QUEUE_NAME, {
      connection: { host: "127.0.0.1", port: redis.port },
    });
    try {
      await job.waitUntilFinished(events, 10_000);
    } finally {
      await events.close();
      await worker.close();
      await queue.close();
    }

    const [row] = await getDb().select().from(verifiedDomains).where(eq(verifiedDomains.id, id));
    expect(row?.status).toBe("verified");
    expect(ses.getDomainIdentity).toHaveBeenCalledTimes(4);
  }, 20_000);

  it("stops after its bounded attempts, leaving the domain pending with a fresh timestamp", async () => {
    const { id, job, queue, worker } = await runPoller(3);
    const events = new QueueEvents(DOMAIN_QUEUE_NAME, {
      connection: { host: "127.0.0.1", port: redis.port },
    });
    try {
      await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow(/still pending/);
    } finally {
      await events.close();
      await worker.close();
      await queue.close();
    }

    // Onboarding check + exactly three polls — then it stopped.
    expect(ses.getDomainIdentity).toHaveBeenCalledTimes(4);
    const [row] = await getDb().select().from(verifiedDomains).where(eq(verifiedDomains.id, id));
    expect(row?.status).toBe("pending");
    expect(Date.now() - row!.lastCheckedAt!.getTime()).toBeLessThan(10_000);
  }, 20_000);
});
