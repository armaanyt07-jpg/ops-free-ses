/**
 * Smoke test: every dashboard page server-renders against real data.
 *
 * The data functions behind each page have their own tests; this catches what
 * those cannot — a page that throws while rendering, a prop mismatch, a client
 * component that breaks on the server. Pages are rendered with React's server
 * renderer on seeded PostgreSQL and a real Redis, the session mocked.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToReadableStream } from "react-dom/server.edge";
import { createElement } from "react";

import { emailIdentities, emailLogs, snsEvents, verifiedDomains } from "@/db/schema";
import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

const tenant = vi.hoisted(() => ({ current: { id: "", email: "dev@example.test", displayName: null } }));
vi.mock("@/server/tenant", () => ({ requireTenant: async () => tenant.current }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Headers({ host: "localhost:3000" }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => undefined }), notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));
vi.mock("@/lib/ses/client", () => ({ describeSesAccount: vi.fn(async () => ({ productionAccessEnabled: false, maxSendRate: 1, max24HourSend: 200, sentLast24Hours: 3, enforcementStatus: "HEALTHY" })), sendViaSes: vi.fn(), createSesClient: vi.fn() }));

let redis: TestRedis; let logId = ""; let templateId = "";
beforeAll(async () => {
  redis = await startTestRedis(); process.env.REDIS_URL = redis.url;
  await resetTestDb();
  tenant.current.id = await createTestUser("dev@example.test");
  const { storeCredential } = await import("@/server/credentials");
  await storeCredential({ userId: tenant.current.id, environment: "production", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", awsRegion: "ap-south-1" });
  const { createApiKey } = await import("@/server/api-keys"); await createApiKey(tenant.current.id, "k", "production");
  await getDb().insert(verifiedDomains).values({ userId: tenant.current.id, domain: "acme.test", environment: "production", status: "verified", awsRegion: "ap-south-1", dkimTokens: ["t1", "t2", "t3"] });
  const tpl = await import("@/server/templates");
  const created = await tpl.createTemplate(tenant.current.id, "dev@example.test", {
    name: "welcome", subject: "Hi {{first_name}}", html: "<h1>Hello {{first_name}}</h1>", text: null,
    variables: [{ name: "first_name", required: true, sample: "Ana" }],
  });
  templateId = created.id;
  await tpl.updateTemplate(tenant.current.id, "dev@example.test", created.id, {
    name: "welcome", subject: "Hey {{first_name}}", html: "<h1>Hello {{first_name}}</h1>", text: null,
    variables: [{ name: "first_name", required: true, sample: "Ana" }],
  });
    const { addSuppression } = await import("@/server/suppression"); await addSuppression({ userId: tenant.current.id, actor: "dev@example.test", email: "x@y.test", note: "why" });
  for (const status of ["delivered", "bounced", "failed", "sent", "queued", "suppressed", "complained"] as const) {
    const [r] = await getDb().insert(emailLogs).values({ userId: tenant.current.id, environment: "production", status, fromAddress: "a@b.test", recipients: ["r@x.test", "s@x.test"], subject: `Subject ${status}`, messageId: `0100-${status}`, errorCode: status === "failed" ? "MessageRejected" : status === "suppressed" ? "RECIPIENT_SUPPRESSED" : null, errorMessage: status === "failed" ? "Email address is not verified." : null, tags: { campaign: "x" }, providerEvent: status === "bounced" ? { recipients: { "r@x.test": { status: "bounced", at: new Date().toISOString(), snsMessageId: "m", bounceType: "Permanent", bounceSubType: "General", diagnostic: "550" } } } : null, sentAt: new Date() }).returning();
    if (status === "bounced") { logId = r!.id; await getDb().insert(snsEvents).values({ messageId: randomUUID(), userId: tenant.current.id, topicArn: "arn:aws:sns:ap-south-1:1:t", messageType: "Notification", eventType: "Bounce", sesMessageId: "0100-bounced", logId, eventAt: new Date(), payload: { bounceType: "Permanent", recipients: [{ email: "r@x.test" }] } }); }
  }
}, 60_000);
afterAll(async () => { await redis.stop(); await closeTestDb(); });

async function html(node: unknown): Promise<string> {
  const stream = await renderToReadableStream(node as never, { onError: (e) => { throw e; } });
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}

const pages: Array<[string, () => Promise<unknown>, string[]]> = [
  ["overview", async () => (await import("@/app/dashboard/page")).default({ searchParams: Promise.resolve({}) }), ["Volume by outcome", "Track deliveries and bounces", "Bounce rate"]],
  ["overview 24h", async () => (await import("@/app/dashboard/page")).default({ searchParams: Promise.resolve({ window: "1" }) }), ["Hourly"]],
  ["activity", async () => (await import("@/app/dashboard/activity/page")).default({ searchParams: Promise.resolve({}) }), ["Subject delivered", "of 7"]],
  ["activity filtered", async () => (await import("@/app/dashboard/activity/page")).default({ searchParams: Promise.resolve({ error: "MessageRejected" }) }), ["Subject failed", "Showing error"]],
  ["activity empty", async () => (await import("@/app/dashboard/activity/page")).default({ searchParams: Promise.resolve({ q: "zzz-nothing" }) }), ["No messages match"]],
  ["message detail", async () => (await import("@/app/dashboard/activity/[id]/page")).default({ params: Promise.resolve({ id: logId }) }), ["Recipients", "Timeline", "Permanent", "campaign=x"]],
  ["errors", async () => (await import("@/app/dashboard/errors/page")).default({ searchParams: Promise.resolve({}) }), ["SES rejected the message", "Suppressed"]],
  ["api keys", async () => (await import("@/app/dashboard/api-keys/page")).default({ searchParams: Promise.resolve({}) }), ["Your keys", "Rotate"]],
  ["aws", async () => (await import("@/app/dashboard/aws/page")).default(), ["SES sandbox", "3 of 200", "ses:CreateConfigurationSet"]],
  ["domains", async () => (await import("@/app/dashboard/domains/page")).default(), ["acme.test", "DNS records to publish", "t1._domainkey.acme.test", "Email addresses", "Send confirmation email"]],
  ["suppressions", async () => (await import("@/app/dashboard/suppressions/page")).default({ searchParams: Promise.resolve({}) }), ["x@y.test", "Recent manual changes", "“why”"]],
  ["webhooks", async () => (await import("@/app/dashboard/webhooks/page")).default(), ["Connect automatically", "Set it up manually instead", "Endpoint"]],
  ["templates", async () => (await import("@/app/dashboard/templates/page")).default({ searchParams: Promise.resolve({}) }), ["welcome", "v2", "New template"]],
  ["new template", async () => (await import("@/app/dashboard/templates/new/page")).default(), ["Create template", "Welcome to Acme, Alice"]],
  ["template editor", async () => (await import("@/app/dashboard/templates/[id]/page")).default({ params: Promise.resolve({ id: templateId }), searchParams: Promise.resolve({}) }), ["Save new version", "Hey Ana", "Versions", "Send a test", templateId]],
  ["template old version", async () => (await import("@/app/dashboard/templates/[id]/page")).default({ params: Promise.resolve({ id: templateId }), searchParams: Promise.resolve({ v: "1" }) }), ["Viewing v1", "Restore as v3", "Hi Ana"]],
  ["health", async () => (await import("@/app/dashboard/health/page")).default(), ["Queue &amp; health"]],
];

describe("first-run setup guide (Phase 8)", () => {
  it("replaces the Overview for an account that cannot send yet", async () => {
    const owner = tenant.current.id;
    tenant.current.id = await createTestUser("new@example.test");
    try {
      const out = await html(await (await import("@/app/dashboard/page")).default({ searchParams: Promise.resolve({}) }));
      for (const text of ["get you sending", "Connect your AWS account", "Create inline policy", "Verify where your emails come from", "0 of 3 done"]) {
        expect(out).toContain(text);
      }
      expect(out).not.toContain("Volume by outcome");
      // One environment: no picker, no badge, no staging anywhere.
      expect(out).not.toContain('id="environment"');
      expect(out.toLowerCase()).not.toContain("staging");
    } finally {
      tenant.current.id = owner;
    }
  }, 20_000);
});

describe("setup with an email address instead of a domain (Phase 8)", () => {
  it("offers the address option and unlocks the test send once it's verified", async () => {
    const owner = tenant.current.id;
    tenant.current.id = await createTestUser("nodomain@example.test");
    try {
      const { storeCredential } = await import("@/server/credentials");
      await storeCredential({ userId: tenant.current.id, environment: "production", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", awsRegion: "ap-south-1" });
      const render = async () => html(await (await import("@/app/dashboard/page")).default({ searchParams: Promise.resolve({}) }));

      expect(await render()).toContain("Don&#x27;t have a domain? Send from your email address");

      await getDb().insert(emailIdentities).values({ userId: tenant.current.id, email: "founder@gmail.test", environment: "production", status: "verified", awsRegion: "ap-south-1", lastCheckedAt: new Date() });
      const out = await render();
      expect(out).toContain("Sending as founder@gmail.test");
      expect(out).toContain('value="founder@gmail.test"'); // test send's From
      expect(out).toContain("2 of 3 done");
    } finally {
      tenant.current.id = owner;
    }
  }, 20_000);
});

describe("overview after the first send (Phase 8)", () => {
  it("keeps the dashboard once anything was sent, and flags what's unfinished", async () => {
    const owner = tenant.current.id;
    tenant.current.id = await createTestUser("sent@example.test");
    try {
      await getDb().insert(emailLogs).values({ userId: tenant.current.id, environment: "production", status: "failed", fromAddress: "a@b.test", recipients: ["r@x.test"], subject: "s" });
      const out = await html(await (await import("@/app/dashboard/page")).default({ searchParams: Promise.resolve({}) }));
      expect(out).toContain("Volume by outcome");
      expect(out).toContain("Setup isn&#x27;t finished");
      expect(out).toContain("No verified domain");
      expect(out).not.toContain("get you sending");
    } finally {
      tenant.current.id = owner;
    }
  }, 20_000);
});

describe("every dashboard page server-renders", () => {
  it.each(pages)("%s", async (_name, load, expected) => {
    const out = await html(await load());
    for (const text of expected) expect(out).toContain(text);
  }, 20_000);

  it("layout + nav render", async () => {
    const Layout = (await import("@/app/dashboard/layout")).default;
    const out = await html(await Layout({ children: createElement("p", null, "child") }));
    expect(out).toContain("Suppressions"); expect(out).toContain("child"); expect(out).toContain('aria-current="page"');
  });
});

describe("production-access assistant page", () => {
  const page = async () => (await import("@/app/dashboard/sandbox/page")).default();

  it("renders the questionnaire and lists what is missing", async () => {
    const out = await html(await page());
    for (const t of ["Status reported by AWS", "In the sandbox", "Questionnaire", "Answer these to generate the request"]) {
      expect(out).toContain(t);
    }
    expect(out).not.toContain("Copy use case description");
  });

  it("shows a draft with sources, and no copy buttons before review", async () => {
    const sandbox = await import("@/server/sandbox");
    await sandbox.saveDraft(tenant.current.id, "production", {
      region: "ap-south-1", mailType: "TRANSACTIONAL", companyName: "Quokka", websiteUrl: "https://quokka.example",
      useCase: "Quokka is a bookkeeping app for freelancers that sends sign-up confirmations and password resets.",
      emailTypes: ["password_reset"], dailyVolume: 250,
      acquisitionDetails: "Recipients create their own accounts and enter their address.",
      bounceHandling: "We stop mailing hard-bouncing addresses.", complaintHandling: "We remove complainers at once.",
      suppressionStrategy: "We check a suppression list before every send.",
    });
    const out = await html(await page());
    for (const t of ["Draft — for your review", "Source: Your answer: use case", "Approximately 250 emails per day", "I have reviewed this request"]) {
      expect(out).toContain(t);
    }
    expect(out).not.toContain("Copy use case description");
  });

  it("after review, offers copy and the console link — and still claims nothing", async () => {
    const sandbox = await import("@/server/sandbox");
    const built = await sandbox.buildRequest(tenant.current.id, "production");
    if (!built.ok) throw new Error("expected complete");
    await sandbox.markReviewed(tenant.current.id, "production", "dev@example.test", built.hash);

    const out = await html(await page());
    for (const t of ["Reviewed", "Copy use case description", "console.aws.amazon.com/ses/home?region=ap-south-1", "Nothing is submitted by this platform"]) {
      expect(out).toContain(t);
    }
    expect(out.toLowerCase()).not.toMatch(/you will be approved|approval is likely|guaranteed/);
  });
});
