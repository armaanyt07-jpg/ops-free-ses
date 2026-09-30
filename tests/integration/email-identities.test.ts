import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailIdentities, snsTopics } from "@/db/schema";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

/**
 * Email-address identities — Phase 8, for users without a domain.
 * Real PostgreSQL; SES mocked at the client boundary.
 */
const ses = vi.hoisted(() => ({
  createDomainIdentity: vi.fn(),
  getDomainIdentity: vi.fn(),
  describeSesAccount: vi.fn(async () => ({
    productionAccessEnabled: false,
    maxSendRate: 1,
    max24HourSend: 200,
    sentLast24Hours: 0,
    enforcementStatus: "HEALTHY",
  })),
  sendViaSes: vi.fn(),
  createSesClient: vi.fn(),
}));
vi.mock("@/lib/ses/client", () => ses);
const events = vi.hoisted(() => ({ attachConfigurationSet: vi.fn(async () => undefined) }));
vi.mock("@/lib/aws/events", () => events);

const ids = await import("@/server/email-identities");
const { storeCredential } = await import("@/server/credentials");
const { onboardDomain, DomainError } = await import("@/server/domains");

function identity(verified: boolean, status = verified ? "SUCCESS" : "PENDING") {
  return { verificationStatus: status, dkimStatus: null, dkimTokens: [], verifiedForSending: verified };
}
function awsError(name: string) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 400 } });
}

let userId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetTestDb();
  userId = await createTestUser();
  await storeCredential({
    userId,
    environment: "production",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    awsRegion: "ap-south-1",
  });
  ses.createDomainIdentity.mockResolvedValue(identity(false));
  ses.getDomainIdentity.mockResolvedValue(identity(false));
});

afterAll(async () => {
  await closeTestDb();
});

describe("adding an address", () => {
  it("asks SES to send the confirmation email and records it as pending", async () => {
    const row = await ids.addEmailIdentity({ userId, environment: "production", email: " Founder@Gmail.com " });

    expect(ses.createDomainIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ region: "ap-south-1" }),
      "founder@gmail.com",
    );
    expect(row).toMatchObject({ email: "founder@gmail.com", status: "pending", awsRegion: "ap-south-1" });
  });

  it("adopts an address already verified in the SES account", async () => {
    ses.createDomainIdentity.mockRejectedValue(awsError("AlreadyExistsException"));
    ses.getDomainIdentity.mockResolvedValue(identity(true));
    const row = await ids.addEmailIdentity({ userId, environment: "production", email: "me@example.com" });
    expect(row.status).toBe("verified");
  });

  it("adding the same address twice keeps one row", async () => {
    await ids.addEmailIdentity({ userId, environment: "production", email: "me@example.com" });
    await ids.addEmailIdentity({ userId, environment: "production", email: "me@example.com" });
    expect(await ids.listEmailIdentities(userId)).toHaveLength(1);
  });

  it.each(["not-an-email", "", "a@b"])("rejects %j before calling SES", async (email) => {
    await expect(ids.addEmailIdentity({ userId, environment: "production", email })).rejects.toBeInstanceOf(
      ids.EmailIdentityError,
    );
    expect(ses.createDomainIdentity).not.toHaveBeenCalled();
  });

  it("needs a credential for the environment", async () => {
    await expect(
      ids.addEmailIdentity({ userId, environment: "staging", email: "me@example.com" }),
    ).rejects.toThrow(/Connect your AWS account for staging/);
  });

  it("applies the events configuration set when events are connected", async () => {
    await getDb().insert(snsTopics).values({
      userId,
      topicArn: "arn:aws:sns:ap-south-1:123456789012:ops-free-ses-events",
      managed: true,
      environment: "production",
    });
    await ids.addEmailIdentity({ userId, environment: "production", email: "me@example.com" });
    expect(events.attachConfigurationSet).toHaveBeenCalledWith(expect.anything(), "me@example.com");
  });
});

describe("checking", () => {
  async function add() {
    return ids.addEmailIdentity({ userId, environment: "production", email: "me@example.com" });
  }

  it("turns verified once the link was clicked", async () => {
    const row = await add();
    ses.getDomainIdentity.mockResolvedValue(identity(true));
    expect((await ids.checkEmailIdentity(userId, row.id))?.status).toBe("verified");
  });

  it("reports failed when the link expired or the identity was deleted", async () => {
    const row = await add();
    ses.getDomainIdentity.mockResolvedValue(identity(false, "FAILED"));
    expect((await ids.checkEmailIdentity(userId, row.id))?.status).toBe("failed");

    ses.getDomainIdentity.mockRejectedValue(awsError("NotFoundException"));
    const again = await add();
    expect((await ids.checkEmailIdentity(userId, again.id))?.status).toBe("failed");
  });

  it("keeps the last status when SES is unreachable", async () => {
    const row = await add();
    ses.getDomainIdentity.mockRejectedValue(awsError("ServiceUnavailable"));
    expect((await ids.checkEmailIdentity(userId, row.id))?.status).toBe("pending");
  });

  it("page refreshes respect the cooldown; an explicit check does not", async () => {
    await add(); // lastCheckedAt = now
    ses.getDomainIdentity.mockClear();
    await ids.refreshPendingEmailIdentities(userId);
    expect(ses.getDomainIdentity).not.toHaveBeenCalled();

    const [row] = await ids.listEmailIdentities(userId);
    await ids.checkEmailIdentity(userId, row!.id);
    expect(ses.getDomainIdentity).toHaveBeenCalledTimes(1);
  });

  it("page refreshes pick up a clicked link after the cooldown", async () => {
    const row = await add();
    await getDb().update(emailIdentities).set({ lastCheckedAt: new Date(Date.now() - 60_000) });
    ses.getDomainIdentity.mockResolvedValue(identity(true));
    const rows = await ids.refreshPendingEmailIdentities(userId);
    expect(rows.find((r) => r.id === row.id)?.status).toBe("verified");
  });
});

describe("tenant isolation", () => {
  it("one tenant cannot check or remove another's address", async () => {
    const row = await ids.addEmailIdentity({ userId, environment: "production", email: "me@example.com" });
    const other = await createTestUser();
    expect(await ids.checkEmailIdentity(other, row.id)).toBeNull();
    expect(await ids.removeEmailIdentity(other, row.id)).toBe(false);
    expect(await ids.listEmailIdentities(other)).toHaveLength(0);
    expect(await ids.removeEmailIdentity(userId, row.id)).toBe(true);
  });
});

describe("hosting-platform subdomains", () => {
  it("explains why a vercel.app address can't be a sending domain", async () => {
    const attempt = onboardDomain({ userId, environment: "production", domain: "https://myapp.vercel.app" });
    await expect(attempt).rejects.toBeInstanceOf(DomainError);
    await expect(
      onboardDomain({ userId, environment: "production", domain: "myapp.vercel.app" }),
    ).rejects.toThrow(/belongs to Vercel.*Send from your email address instead/);
    expect(ses.createDomainIdentity).not.toHaveBeenCalled();
  });
});
