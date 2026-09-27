import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emailLogs, emailTemplateVersions } from "@/db/schema";
import type { SendJobData } from "@/lib/queue/send-queue";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";
import { startTestRedis, type TestRedis } from "../support/test-redis";

/**
 * Phase 5 exit criterion, end to end: create reusable templates, preview with
 * sample data, validate variables, and send them through the API.
 *
 * Real repository, real `POST /api/v1/send`, real queue, real PostgreSQL.
 */
const tenant = vi.hoisted(() => ({ current: { id: "", email: "dev@example.test", displayName: null } }));
vi.mock("@/server/tenant", () => ({ requireTenant: async () => tenant.current }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
}));
vi.mock("@/lib/ses/client", () => ({ describeSesAccount: vi.fn(), sendViaSes: vi.fn(), createSesClient: vi.fn() }));

let redis: TestRedis;
beforeAll(async () => {
  redis = await startTestRedis();
  process.env.REDIS_URL = redis.url;
}, 30_000);

const templates = await import("@/server/templates");
const { NextRequest } = await import("next/server");
const { POST } = await import("@/app/api/v1/send/route");
const { createApiKey } = await import("@/server/api-keys");
const { saveTemplate, sendTemplateTest, restoreTemplateVersion } = await import("@/app/dashboard/templates/actions");
const { getSendQueue, closeSendQueue, jobIdForLog } = await import("@/lib/queue/send-queue");

let userId: string;
let key: string;

const WELCOME = {
  name: "welcome",
  subject: "Welcome, {{first_name}}",
  html: "<h1>Hi {{first_name}}</h1><p>Your plan: {{plan}}</p>",
  text: null,
  variables: [
    { name: "first_name", required: true, sample: "Ana" },
    { name: "plan", required: false, defaultValue: "Free", sample: "Pro" },
  ],
};

beforeEach(async () => {
  await redis.flush();
  await resetTestDb();
  userId = await createTestUser("dev@example.test");
  tenant.current = { id: userId, email: "dev@example.test", displayName: null };
  key = (await createApiKey(userId, "k", "production")).secret;
});

afterAll(async () => {
  await closeSendQueue().catch(() => undefined);
  await redis.stop();
  await closeTestDb();
});

function send(body: object) {
  return POST(
    new NextRequest("https://app.test/api/v1/send", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function jobFor(logId: string): Promise<SendJobData> {
  const job = await getSendQueue().getJob(jobIdForLog(logId));
  return job!.data as SendJobData;
}

describe("storage and versions", () => {
  it("creates v1 with an immutable version row", async () => {
    const t = await templates.createTemplate(userId, "dev@example.test", WELCOME);
    expect(t).toMatchObject({ version: 1, active: true, name: "welcome" });
    const versions = await templates.listVersions(userId, t.id);
    expect(versions.map((v) => [v.version, v.createdBy])).toEqual([[1, "dev@example.test"]]);
  });

  it("refuses to store a template with errors, returning the issues", async () => {
    const bad = { ...WELCOME, html: "<p>{{first_name}} {{missing}}</p>" };
    await expect(templates.createTemplate(userId, "a", bad)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ severity: "error", message: expect.stringMatching(/missing.*not defined/) }),
      ]),
    });
  });

  it("each content change is a new version; a no-op save or a rename is not", async () => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    const same = await templates.updateTemplate(userId, "a", t.id, WELCOME);
    expect(same.newVersion).toBe(false);

    const renamed = await templates.updateTemplate(userId, "a", t.id, { ...WELCOME, name: "welcome-2" });
    expect(renamed).toMatchObject({ newVersion: false, template: { version: 1, name: "welcome-2" } });

    const edited = await templates.updateTemplate(userId, "b", t.id, { ...WELCOME, name: "welcome-2", subject: "Hello {{first_name}}" });
    expect(edited).toMatchObject({ newVersion: true, template: { version: 2 } });
    expect((await templates.listVersions(userId, t.id)).map((v) => v.version)).toEqual([2, 1]);
  });

  it("restoring appends a new version with the old content", async () => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    await templates.updateTemplate(userId, "a", t.id, { ...WELCOME, subject: "Changed {{first_name}}" });
    const restored = await templates.restoreVersion(userId, "a", t.id, 1);

    expect(restored).toMatchObject({ version: 3, subject: WELCOME.subject });
    const v3 = await templates.getVersion(userId, t.id, 3);
    expect(v3?.note).toBe("Restored from v1");
    // History is intact.
    expect((await templates.getVersion(userId, t.id, 2))?.subject).toBe("Changed {{first_name}}");
    await expect(templates.restoreVersion(userId, "a", t.id, 3)).rejects.toThrow(/already the current/);
  });

  it("names are unique per tenant, not globally", async () => {
    await templates.createTemplate(userId, "a", WELCOME);
    await expect(templates.createTemplate(userId, "a", WELCOME)).rejects.toThrow(/already exists/);
    await expect(templates.createTemplate(await createTestUser(), "a", WELCOME)).resolves.toBeDefined();
  });

  it("is invisible to other tenants", async () => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    const other = await createTestUser();
    expect(await templates.getTemplate(other, t.id)).toBeNull();
    expect(await templates.listVersions(other, t.id)).toEqual([]);
    await expect(templates.updateTemplate(other, "x", t.id, WELCOME)).rejects.toThrow(/not found/);
    expect(await templates.setTemplateActive(other, t.id, false)).toBe(false);
    expect((await templates.listTemplates(other)).total).toBe(0);
  });

  it("lists with search, archive filter and totals", async () => {
    await templates.createTemplate(userId, "a", WELCOME);
    const b = await templates.createTemplate(userId, "a", { ...WELCOME, name: "receipt" });
    await templates.setTemplateActive(userId, b.id, false);

    expect((await templates.listTemplates(userId)).rows.map((t) => t.name)).toEqual(["welcome"]);
    expect((await templates.listTemplates(userId, { includeArchived: true })).total).toBe(2);
    expect((await templates.listTemplates(userId, { search: "rec", includeArchived: true })).rows.map((t) => t.name)).toEqual(["receipt"]);
  });
});

describe("POST /api/v1/send with a template", () => {
  it("renders the template and records its id and version on the log", async () => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    const res = await send({ from: "app@example.com", to: ["bob@example.com"], templateId: t.id, variables: { first_name: "<Bob>" } });

    expect(res.status).toBe(202);
    const { id } = await res.json();
    const [log] = await getDb().select().from(emailLogs).where(eq(emailLogs.id, id));
    expect(log).toMatchObject({ templateId: t.id, templateVersion: 1, subject: "Welcome, <Bob>" });

    const job = await jobFor(id);
    expect(job.html).toBe("<h1>Hi &lt;Bob&gt;</h1><p>Your plan: Free</p>");
    // No text part was written, so one was generated.
    expect(job.text).toBe("Hi <Bob>\n\nYour plan: Free");
  });

  it("sends the current version, and the log pins which one it was", async () => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    await templates.updateTemplate(userId, "a", t.id, { ...WELCOME, subject: "v2 for {{first_name}}" });

    const { id } = await (await send({ from: "a@x.com", to: ["b@x.com"], templateId: t.id, variables: { first_name: "Ann" } })).json();
    const [log] = await getDb().select().from(emailLogs).where(eq(emailLogs.id, id));
    expect(log).toMatchObject({ templateVersion: 2, subject: "v2 for Ann" });

    const [v2] = await getDb().select().from(emailTemplateVersions).where(eq(emailTemplateVersions.version, 2));
    expect(v2?.subject).toBe("v2 for {{first_name}}");
  });

  it.each([
    ["a missing required variable", {}, /first_name.*is required/],
    ["an unknown variable", { first_name: "a", frist_name: "b" }, /frist_name.*not a variable/],
    ["an object value", { first_name: { x: 1 } }, /string, number or boolean/],
  ])("refuses %s with 400 and the reasons, writing nothing", async (_label, variables, reason) => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    const res = await send({ from: "a@x.com", to: ["b@x.com"], templateId: t.id, variables });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(JSON.stringify(body.error.details.variables)).toMatch(reason);
    expect(await getDb().select().from(emailLogs)).toHaveLength(0);
  });

  it("refuses an archived template", async () => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    await templates.setTemplateActive(userId, t.id, false);
    const res = await send({ from: "a@x.com", to: ["b@x.com"], templateId: t.id, variables: { first_name: "A" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/archived/);
  });

  it("another tenant's template id looks exactly like a missing one", async () => {
    const theirs = await templates.createTemplate(await createTestUser(), "x", WELCOME);
    const res = await send({ from: "a@x.com", to: ["b@x.com"], templateId: theirs.id, variables: { first_name: "A" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("No template with that id exists in this account.");
  });

  it("still applies suppression to templated sends", async () => {
    const { addSuppression } = await import("@/server/suppression");
    await addSuppression({ userId, actor: "t", email: "gone@x.com", note: "test" });
    const t = await templates.createTemplate(userId, "a", WELCOME);
    const res = await send({ from: "a@x.com", to: ["gone@x.com"], templateId: t.id, variables: { first_name: "A" } });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/send with inline content + variables (the SRS §7 example)", () => {
  it("interpolates the inline content", async () => {
    const res = await send({
      from: "noreply@example.com",
      to: ["alice@example.com"],
      subject: "Welcome {{first_name}}",
      html: "<h1>Hello {{first_name}}</h1>",
      text: "Hello {{first_name}}",
      variables: { first_name: "Alice" },
      tags: { campaign: "onboarding" },
    });
    expect(res.status).toBe(202);
    const { id } = await res.json();
    const job = await jobFor(id);
    expect(job).toMatchObject({ subject: "Welcome Alice", html: "<h1>Hello Alice</h1>", text: "Hello Alice" });
  });

  it("without variables, inline content is sent literally — unchanged from before", async () => {
    const res = await send({ from: "a@x.com", to: ["b@x.com"], subject: "Literal {{x}}", text: "{{x}}" });
    expect(res.status).toBe(202);
    const job = await jobFor((await res.json()).id);
    expect(job).toMatchObject({ subject: "Literal {{x}}", text: "{{x}}" });
  });

  it("refuses inline content missing a referenced variable", async () => {
    const res = await send({ from: "a@x.com", to: ["b@x.com"], subject: "Hi {{name}}", text: "x", variables: {} });
    expect(res.status).toBe(400);
  });
});

describe("dashboard actions", () => {
  function form(fields: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  }

  it("save validates on the server whatever the browser sent", async () => {
    const result = await saveTemplate(
      {},
      form({ name: "x", subject: "Hi {{a}}", html: "<p>{{a}}</p>", text: "", variables: "[]" }),
    );
    expect(result.error).toMatch(/has errors/);
    expect(result.issues?.[0]?.message).toMatch(/not defined/);
  });

  it("create redirects to the new template; update reports the new version", async () => {
    const payload = {
      name: "welcome",
      subject: WELCOME.subject,
      html: WELCOME.html,
      text: "",
      variables: JSON.stringify(WELCOME.variables),
    };
    const redirect = await saveTemplate({}, form(payload)).catch((e: { url: string }) => e);
    expect((redirect as { url: string }).url).toMatch(/^\/dashboard\/templates\/[0-9a-f-]{36}\?created=1$/);

    const [t] = (await templates.listTemplates(userId)).rows;
    const updated = await saveTemplate({}, form({ ...payload, id: t!.id, subject: "New {{first_name}}" }));
    expect(updated.saved).toMatchObject({ version: 2, newVersion: true });
  });

  it("rejects a malformed variables payload", async () => {
    const result = await saveTemplate({}, form({ name: "x", subject: "s", html: "<p>h</p>", text: "", variables: "{not json" }));
    expect(result.error).toBe("Invalid variables.");
  });

  it("test send renders the saved version with sample data and queues it", async () => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    const result = await sendTemplateTest(
      {},
      form({ id: t.id, from: "me@example.com", to: "success@simulator.amazonses.com", variables: JSON.stringify({ first_name: "Ana", plan: "Pro" }) }),
    );
    expect(result.sent).toMatchObject({ version: 1, environment: "production" });

    const [log] = await getDb().select().from(emailLogs).where(eq(emailLogs.id, result.sent!.logId));
    expect(log).toMatchObject({ templateId: t.id, templateVersion: 1, subject: "Welcome, Ana", tags: { source: "template-test" } });
    expect((await jobFor(log!.id)).html).toContain("Your plan: Pro");
  });

  it("test send reports variable problems", async () => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    const result = await sendTemplateTest({}, form({ id: t.id, from: "a@x.com", to: "b@x.com", variables: "{}" }));
    expect(result.details).toEqual(["`first_name` is required."]);
  });

  it("restore action appends a version", async () => {
    const t = await templates.createTemplate(userId, "a", WELCOME);
    await templates.updateTemplate(userId, "a", t.id, { ...WELCOME, subject: "Other {{first_name}}" });
    await restoreTemplateVersion(form({ id: t.id, version: "1" })).catch(() => undefined);
    expect((await templates.getTemplate(userId, t.id))?.version).toBe(3);
  });
});
