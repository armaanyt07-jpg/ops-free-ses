/**
 * What the customer sees (Phase 10): the one-click button when the platform is
 * set up for it, the unchanged access-key flow when it isn't, and a role
 * credential shown without any key. Server-rendered with the session mocked,
 * like tests/integration/pages-render.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToReadableStream } from "react-dom/server.edge";
import { createElement } from "react";

import { createTestUser } from "../support/factories";
import { closeTestDb, resetTestDb } from "../support/test-db";

const tenant = vi.hoisted(() => ({ current: { id: "", email: "dev@example.test", displayName: null } }));
vi.mock("@/server/tenant", () => ({ requireTenant: async () => tenant.current }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));
vi.mock("@/lib/ses/client", () => ({
  describeSesAccount: vi.fn(async () => ({
    productionAccessEnabled: false,
    maxSendRate: 1,
    max24HourSend: 200,
    sentLast24Hours: 3,
    enforcementStatus: "HEALTHY",
  })),
  sendViaSes: vi.fn(),
  createSesClient: vi.fn(),
}));

const ENV = {
  PLATFORM_AWS_ACCESS_KEY_ID: "AKIAPLATFORMEXAMPLE1",
  PLATFORM_AWS_SECRET_ACCESS_KEY: "platform-secret-key-example-0000000000",
  PLATFORM_AWS_PRINCIPAL_ARN: "arn:aws:iam::111122223333:user/ops-free-platform",
  AWS_CONNECT_TEMPLATE_URL: "https://ops-free-connect.s3.ap-south-1.amazonaws.com/connect/opsfree-connect.yaml",
  AWS_CONNECT_TOPIC_ARN: "arn:aws:sns:ap-south-1:111122223333:ops-free-connect",
};

async function html(node: unknown): Promise<string> {
  const stream = await renderToReadableStream(node as never, {
    onError: (e) => {
      throw e;
    },
  });
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}

beforeAll(async () => {
  await resetTestDb();
  tenant.current.id = await createTestUser("dev@example.test");
});
afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await closeTestDb();
});

describe("connect options", () => {
  it("without the platform configured, shows only the access-key steps", async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    const { AwsConnectOptions } = await import("@/components/dashboard/aws-connect-options");
    const out = await html(createElement(AwsConnectOptions));
    expect(out).toContain("Access key ID");
    expect(out).toContain("ses:CreateConfigurationSet");
    expect(out).not.toContain("Connect AWS");
    expect(out).not.toContain("Advanced");
  });

  it("with it configured, leads with one click and keeps access keys under Advanced", async () => {
    Object.assign(process.env, ENV);
    const { AwsConnectOptions } = await import("@/components/dashboard/aws-connect-options");
    const out = await html(createElement(AwsConnectOptions));
    expect(out).toContain("Connect AWS");
    expect(out).toContain("Region you send from");
    expect(out).toContain("Asia Pacific (Mumbai)");
    expect(out).toContain("/aws-connect.yaml");
    expect(out).toContain("Advanced: use an IAM access key instead");
    expect(out).toContain("Access key ID");
    // The platform's secrets never reach the page.
    expect(out).not.toContain(ENV.PLATFORM_AWS_SECRET_ACCESS_KEY);
    expect(out).not.toContain(ENV.PLATFORM_AWS_ACCESS_KEY_ID);
  });

  it("hides the button, rather than breaking the page, when only half is configured", async () => {
    Object.assign(process.env, ENV);
    delete process.env.AWS_CONNECT_TOPIC_ARN;
    const { AwsConnectOptions } = await import("@/components/dashboard/aws-connect-options");
    const out = await html(createElement(AwsConnectOptions));
    expect(out).not.toContain("Connect AWS");
    expect(out).toContain("Access key ID");
  });
});

describe("the AWS page for a role credential", () => {
  it("shows the role and that no secret is stored", async () => {
    Object.assign(process.env, ENV);
    const { storeRoleCredential } = await import("@/server/credentials");
    const roleArn = "arn:aws:iam::123456789012:role/OpsFreeSES-abc123def456";
    await storeRoleCredential({
      userId: tenant.current.id,
      environment: "production",
      roleArn,
      externalId: "opsfree-example-external-id-0001",
      awsRegion: "ap-south-1",
    });

    const out = await html(await (await import("@/app/dashboard/aws/page")).default());
    expect(out).toContain("Connected via");
    expect(out).toContain(roleArn);
    expect(out).toContain("none stored");
    expect(out).not.toContain("stored encrypted");
    expect(out).not.toContain("opsfree-example-external-id-0001");
    expect(out).toContain("Replace the credential");
  });
});
