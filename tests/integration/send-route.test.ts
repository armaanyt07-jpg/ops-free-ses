import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailLogs, suppressionList } from "@/db/schema";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Contract test for POST /api/v1/send — SRS §7.
 *
 * Phase 2 moved delivery out of the request. The route's job is now to
 * authenticate, validate, commit the log, and **durably enqueue** before
 * responding 202. Everything downstream of the enqueue is the worker's, and is
 * covered in tests/integration/worker.test.ts.
 *
 * Real Redis, real BullMQ, real PostgreSQL. Only `after()` is stubbed, so the
 * post-response bookkeeping can be awaited deterministically.
 */
const pendingAfter = vi.hoisted(() => [] as Array<() => Promise<void> | void>);
const describeSesAccount = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ses/client", () => ({
  describeSesAccount,
  sendViaSes: vi.fn(),
  createSesClient: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => Promise<void> | void) => {
      pendingAfter.push(callback);
    },
  };
});

let redis: TestRedis;

// REDIS_URL must exist before the queue singleton is first constructed.
beforeAll(async () => {
  redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
}, 30_000);

const { NextRequest } = await import("next/server");
const { POST } = await import("@/app/api/v1/send/route");
const { createApiKey, revokeApiKey, listApiKeys } = await import("@/server/api-keys");
const { storeCredential } = await import("@/server/credentials");
const { getSendQueue, closeSendQueue, jobIdForLog } = await import(
  "@/lib/queue/send-queue"
);

async function flushAfter(): Promise<void> {
  const callbacks = pendingAfter.splice(0, pendingAfter.length);
  for (const callback of callbacks) await callback();
}

const VALID_BODY = {
  from: "noreply@example.com",
  to: ["alice@example.com"],
  subject: "Welcome",
  html: "<h1>Hello</h1>",
};

function request(
  body: unknown,
  headers: Record<string, string> = {},
): InstanceType<typeof NextRequest> {
  return new NextRequest("https://app.test/api/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let userId: string;
let liveKey: string;

beforeEach(async () => {
  vi.clearAllMocks();
  pendingAfter.length = 0;
  process.env.REDIS_URL = redis.url;

  describeSesAccount.mockResolvedValue({
    productionAccessEnabled: true,
    maxSendRate: 14,
    max24HourSend: 50_000,
    sentLast24Hours: 0,
    enforcementStatus: "HEALTHY",
  });

  await redis.flush();
  await resetTestDb();
  userId = await createTestUser("owner@example.test");
  liveKey = (await createApiKey(userId, "backend", "production")).secret;

  await storeCredential({
    userId,
    environment: "production",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    awsRegion: "us-east-1",
  });
});

afterAll(async () => {
  await closeSendQueue().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

async function logRow(id: string) {
  const [row] = await getDb().select().from(emailLogs).where(eq(emailLogs.id, id));
  return row;
}

const auth = () => ({ authorization: `Bearer ${liveKey}` });

describe("authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await POST(request(VALID_BODY));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.requestId).toBeDefined();
  });

  it("rejects a non-bearer scheme", async () => {
    const response = await POST(
      request(VALID_BODY, { authorization: `Basic ${liveKey}` }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects an unknown key", async () => {
    const response = await POST(
      request(VALID_BODY, { authorization: `Bearer sk_live_${"a".repeat(43)}` }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a revoked key and enqueues nothing", async () => {
    const created = await createApiKey(userId, "doomed", "production");
    await revokeApiKey(userId, created.summary.id);

    const response = await POST(
      request(VALID_BODY, { authorization: `Bearer ${created.secret}` }),
    );

    expect(response.status).toBe(401);
    expect((await getSendQueue().getJobCounts("waiting")).waiting).toBe(0);
  });

  // A probing caller must not be able to tell these cases apart.
  it("returns an identical message for unknown and revoked keys", async () => {
    const created = await createApiKey(userId, "doomed", "production");
    await revokeApiKey(userId, created.summary.id);

    const revoked = await (
      await POST(request(VALID_BODY, { authorization: `Bearer ${created.secret}` }))
    ).json();
    const unknown = await (
      await POST(
        request(VALID_BODY, { authorization: `Bearer sk_live_${"b".repeat(43)}` }),
      )
    ).json();

    expect(revoked.error.message).toBe(unknown.error.message);
  });
});

describe("validation", () => {
  it("rejects a malformed JSON body", async () => {
    const response = await POST(request("{not json", auth()));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("rejects a missing sender", async () => {
    const { from: _from, ...rest } = VALID_BODY;
    expect((await POST(request(rest, auth()))).status).toBe(400);
  });

  it("rejects a body with neither html nor text", async () => {
    const { html: _html, ...rest } = VALID_BODY;
    expect((await POST(request(rest, auth()))).status).toBe(400);
  });

  it("reports which field failed", async () => {
    const response = await POST(
      request({ ...VALID_BODY, to: ["not-an-email"] }, auth()),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify((await response.json()).error.details)).toContain("to.0");
  });

  // Phase 5: templateId and inline content are mutually exclusive.
  it("refuses templateId combined with inline content", async () => {
    const response = await POST(
      request(
        { ...VALID_BODY, templateId: "3f0d4b3e-3e5f-4c2a-9a1f-0b7e6d5c4a3b" },
        auth(),
      ),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify((await response.json()).error.details)).toMatch(/mutually exclusive/);
  });

  // Phase 5: a variable the inline content never uses is a typo, not a no-op.
  it("refuses variables the inline content does not use", async () => {
    const response = await POST(
      request({ ...VALID_BODY, variables: { first_name: "Alice" } }, auth()),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify((await response.json()).error.details)).toMatch(/first_name.*not used/);
  });

  it("neither logs nor enqueues for an invalid request", async () => {
    await POST(request({ ...VALID_BODY, subject: "" }, auth()));

    expect(await getDb().select().from(emailLogs)).toHaveLength(0);
    expect((await getSendQueue().getJobCounts("waiting")).waiting).toBe(0);
  });
});

describe("accepted send", () => {
  it("returns 202 with the SRS §7 acceptance body", async () => {
    const response = await POST(request(VALID_BODY, auth()));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      id: expect.any(String),
      status: "queued",
      message: "Accepted for asynchronous delivery",
    });
  });

  /**
   * SRS §8: acceptance IS durable queue acceptance. By the time the caller
   * holds a 202, both the log row and the queue job must already exist.
   */
  it("has committed the log and enqueued the job before responding", async () => {
    const { id } = await (await POST(request(VALID_BODY, auth()))).json();

    const row = await logRow(id);
    expect(row?.status).toBe("queued");
    expect(row?.userId).toBe(userId);

    const job = await getSendQueue().getJob(jobIdForLog(id));
    expect(job).toBeDefined();
    expect(job!.data).toMatchObject({
      logId: id,
      userId,
      environment: "production",
      from: "noreply@example.com",
      to: ["alice@example.com"],
      subject: "Welcome",
      html: "<h1>Hello</h1>",
    });
  });

  // The job carries the message so the worker need not re-read the row.
  it("carries the correlation id into the job", async () => {
    const response = await POST(
      request(VALID_BODY, { ...auth(), "x-request-id": "trace-abc" }),
    );
    const { id } = await response.json();

    const job = await getSendQueue().getJob(jobIdForLog(id));
    expect(job!.data.requestId).toBe("trace-abc");
    expect(response.headers.get("X-Request-Id")).toBe("trace-abc");
  });

  it("stamps a correlation id when the caller supplies none", async () => {
    const response = await POST(request(VALID_BODY, auth()));
    expect(response.headers.get("X-Request-Id")).toMatch(/^req_/);
  });

  it("de-duplicates recipients before enqueueing", async () => {
    const { id } = await (
      await POST(
        request(
          {
            ...VALID_BODY,
            to: ["Alice@example.com", "alice@example.com", "bob@example.com"],
          },
          auth(),
        ),
      )
    ).json();

    const job = await getSendQueue().getJob(jobIdForLog(id));
    expect(job!.data.to).toEqual(["Alice@example.com", "bob@example.com"]);
  });

  it("routes a staging key to the staging environment", async () => {
    const stagingKey = (await createApiKey(userId, "stg", "staging")).secret;

    const { id } = await (
      await POST(request(VALID_BODY, { authorization: `Bearer ${stagingKey}` }))
    ).json();

    expect((await logRow(id))?.environment).toBe("staging");
    const job = await getSendQueue().getJob(jobIdForLog(id));
    expect(job!.data.environment).toBe("staging");
  });

  it("records last use of the API key", async () => {
    await POST(request(VALID_BODY, auth()));
    await flushAfter();

    const [key] = await listApiKeys(userId);
    expect(key?.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe("idempotency", () => {
  it("accepts the first request carrying a key", async () => {
    const response = await POST(
      request(VALID_BODY, { ...auth(), "idempotency-key": "order-1" }),
    );
    expect(response.status).toBe(202);
  });

  // SRS §7 lists 409 for an idempotency conflict.
  it("returns 409 on replay", async () => {
    const first = await (
      await POST(request(VALID_BODY, { ...auth(), "idempotency-key": "order-2" }))
    ).json();

    const response = await POST(
      request(VALID_BODY, { ...auth(), "idempotency-key": "order-2" }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.details.id).toBe(first.id);
  });

  it("enqueues only one job for a replayed key", async () => {
    await POST(request(VALID_BODY, { ...auth(), "idempotency-key": "order-3" }));
    await POST(request(VALID_BODY, { ...auth(), "idempotency-key": "order-3" }));

    const counts = await getSendQueue().getJobCounts("waiting", "active", "delayed");
    expect((counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0)).toBe(1);
  });

  /**
   * The queue-level half of the guarantee: the job id is derived from the log
   * id, so BullMQ itself refuses a second job for the same accepted message
   * even if the enqueue were somehow attempted twice.
   */
  it("derives the job id from the log id", async () => {
    const { id } = await (await POST(request(VALID_BODY, auth()))).json();
    const job = await getSendQueue().getJob(jobIdForLog(id));
    expect(job!.id).toBe(jobIdForLog(id));
  });

  it("rejects an over-long idempotency key", async () => {
    const response = await POST(
      request(VALID_BODY, { ...auth(), "idempotency-key": "x".repeat(256) }),
    );
    expect(response.status).toBe(400);
  });
});

/**
 * Exit criterion: the API must respond only after durable queue acceptance.
 * If the queue cannot take the job, the caller must learn that — returning 202
 * for a job that was never queued would silently drop mail.
 */
describe("queue unavailable", () => {
  beforeEach(async () => {
    await closeSendQueue().catch(() => undefined);
    // Point the queue at a port with nothing listening.
    process.env.REDIS_URL = "redis://127.0.0.1:1";
  });

  afterAll(async () => {
    // Drop the singleton bound to the dead port as well as restoring the URL,
    // or every test after this block inherits a queue that cannot connect.
    await closeSendQueue().catch(() => undefined);
    process.env.REDIS_URL = redis.url;
  });

  it("returns 503 QUEUE_UNAVAILABLE rather than 202", async () => {
    const response = await POST(request(VALID_BODY, auth()));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("QUEUE_UNAVAILABLE");
  }, 20_000);

  // The log row is already committed at that point; leaving it in `queued`
  // with no job to drive it would strand the message invisibly.
  it("closes out the orphaned log row instead of stranding it", async () => {
    await POST(request(VALID_BODY, auth()));

    const rows = await getDb().select().from(emailLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.errorCode).toBe("QUEUE_UNAVAILABLE");
  }, 20_000);
});

describe("suppression (Phase 3)", () => {
  async function suppress(email: string, active = true) {
    await getDb()
      .insert(suppressionList)
      .values({ userId, email, reason: "hard_bounce", active });
  }

  it("refuses a suppressed recipient with 403 RECIPIENT_SUPPRESSED", async () => {
    await suppress("alice@example.com");

    const response = await POST(request(VALID_BODY, auth()));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("RECIPIENT_SUPPRESSED");
    expect(body.error.details).toEqual({ suppressed: ["alice@example.com"] });
  });

  it("writes no log and enqueues nothing — SES is never reached", async () => {
    await suppress("alice@example.com");
    await POST(request(VALID_BODY, auth()));

    expect(await getDb().select().from(emailLogs)).toHaveLength(0);
    expect((await getSendQueue().getJobCounts("waiting")).waiting).toBe(0);
  });

  it("matches case-insensitively", async () => {
    await suppress("alice@example.com");
    const response = await POST(
      request({ ...VALID_BODY, to: ["Alice@EXAMPLE.com"] }, auth()),
    );
    expect(response.status).toBe(403);
  });

  it("refuses the whole message if any one recipient is suppressed", async () => {
    await suppress("bob@example.com");
    const response = await POST(
      request({ ...VALID_BODY, to: ["alice@example.com", "bob@example.com"] }, auth()),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.details).toEqual({
      suppressed: ["bob@example.com"],
    });
  });

  it("ignores inactive suppressions", async () => {
    await suppress("alice@example.com", false);
    expect((await POST(request(VALID_BODY, auth()))).status).toBe(202);
  });

  it("does not consume the idempotency key of a refused request", async () => {
    await suppress("alice@example.com");
    const headers = { ...auth(), "idempotency-key": "idem-suppressed" };
    expect((await POST(request(VALID_BODY, headers))).status).toBe(403);

    await getDb().delete(suppressionList);
    expect((await POST(request(VALID_BODY, headers))).status).toBe(202);
  });

  it("is scoped to the tenant", async () => {
    const other = await createTestUser();
    await getDb()
      .insert(suppressionList)
      .values({ userId: other, email: "alice@example.com", reason: "complaint" });

    expect((await POST(request(VALID_BODY, auth()))).status).toBe(202);
  });
});
