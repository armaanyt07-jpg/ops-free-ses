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

import { emailLogs, snsEvents } from "@/db/schema";
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
  ["overview", async () => (await import("@/app/dashboard/page")).default({ searchParams: Promise.resolve({}) }), ["Volume by outcome", "Finish setting up", "Bounce rate"]],
  ["overview 24h", async () => (await import("@/app/dashboard/page")).default({ searchParams: Promise.resolve({ window: "1" }) }), ["Hourly"]],
  ["activity", async () => (await import("@/app/dashboard/activity/page")).default({ searchParams: Promise.resolve({}) }), ["Subject delivered", "of 7"]],
  ["activity filtered", async () => (await import("@/app/dashboard/activity/page")).default({ searchParams: Promise.resolve({ error: "MessageRejected" }) }), ["Subject failed", "Showing error"]],
  ["activity empty", async () => (await import("@/app/dashboard/activity/page")).default({ searchParams: Promise.resolve({ q: "zzz-nothing" }) }), ["No messages match"]],
  ["message detail", async () => (await import("@/app/dashboard/activity/[id]/page")).default({ params: Promise.resolve({ id: logId }) }), ["Recipients", "Timeline", "Permanent", "campaign=x"]],
  ["errors", async () => (await import("@/app/dashboard/errors/page")).default({ searchParams: Promise.resolve({}) }), ["SES rejected the message", "Suppressed"]],
  ["api keys", async () => (await import("@/app/dashboard/api-keys/page")).default({ searchParams: Promise.resolve({}) }), ["Production keys", "Rotate"]],
  ["aws", async () => (await import("@/app/dashboard/aws/page")).default(), ["SES sandbox", "3 of 200"]],
  ["domains", async () => (await import("@/app/dashboard/domains/page")).default(), ["No production domains yet"]],
  ["suppressions", async () => (await import("@/app/dashboard/suppressions/page")).default({ searchParams: Promise.resolve({}) }), ["x@y.test", "Recent manual changes", "“why”"]],
  ["webhooks", async () => (await import("@/app/dashboard/webhooks/page")).default(), ["Endpoint"]],
  ["templates", async () => (await import("@/app/dashboard/templates/page")).default({ searchParams: Promise.resolve({}) }), ["welcome", "v2", "New template"]],
  ["new template", async () => (await import("@/app/dashboard/templates/new/page")).default(), ["Create template", "Welcome to Acme, Alice"]],
  ["template editor", async () => (await import("@/app/dashboard/templates/[id]/page")).default({ params: Promise.resolve({ id: templateId }), searchParams: Promise.resolve({}) }), ["Save new version", "Hey Ana", "Versions", "Send a test", templateId]],
  ["template old version", async () => (await import("@/app/dashboard/templates/[id]/page")).default({ params: Promise.resolve({ id: templateId }), searchParams: Promise.resolve({ v: "1" }) }), ["Viewing v1", "Restore as v3", "Hi Ana"]],
  ["health", async () => (await import("@/app/dashboard/health/page")).default(), ["Queue &amp; health"]],
];

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
