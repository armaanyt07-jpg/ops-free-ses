/**
 * One-click "Connect AWS" (Phase 10), the pure parts: the ExternalId, the
 * console link, CloudFormation's callback, the template, the platform config
 * and the role-assuming credential provider.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTION_TTL_MS,
  accountOfRoleArn,
  buildResponse,
  customResourceSchema,
  isTrustedResponseUrl,
  newConnectionId,
  newExternalId,
  putResponse,
  quickCreateUrl,
} from "@/lib/aws/connect";
import { CONNECT_ROLE_PREFIX, buildConnectTemplate } from "@/lib/aws/connect-template";
import {
  SESSION_SECONDS,
  __setAssumeForTests,
  assumedCredentials,
  awsCredentialsFor,
  type AssumeFn,
} from "@/lib/aws/credentials";
import { EVENTS_ACTIONS, REQUIRED_ACTIONS, ROUTE53_ACTIONS } from "@/lib/aws/iam-policy";
import { PlatformAwsConfigError, oneClickAllowedFor, oneClickConnectAvailable, platformAws } from "@/lib/aws/platform";

const FULL_ENV = {
  PLATFORM_AWS_ACCESS_KEY_ID: "AKIAPLATFORMEXAMPLE1",
  PLATFORM_AWS_SECRET_ACCESS_KEY: "platform-secret-key-example-0000000000",
  PLATFORM_AWS_PRINCIPAL_ARN: "arn:aws:iam::111122223333:user/ops-free-platform",
  AWS_CONNECT_TEMPLATE_URL: "https://ops-free-connect.s3.ap-south-1.amazonaws.com/connect/opsfree-connect.yaml",
  AWS_CONNECT_TOPIC_ARN: "arn:aws:sns:ap-south-1:111122223333:ops-free-connect",
};

describe("the ExternalId", () => {
  it("is long, unguessable and never repeats", () => {
    const ids = new Set(Array.from({ length: 500 }, newExternalId));
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(/^opsfree-[A-Za-z0-9_-]{32}$/);
      // The characters AWS allows in an ExternalId.
      expect(id).toMatch(/^[\w+=,.@:/-]{2,1224}$/);
    }
  });

  it("makes short, unique role handles", () => {
    expect(newConnectionId()).toMatch(/^[0-9a-f]{12}$/);
    expect(newConnectionId()).not.toBe(newConnectionId());
  });

  it("an unfinished click stops being valid after two hours", () => {
    expect(CONNECTION_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });
});

describe("the console link", () => {
  const platform = platformAws(FULL_ENV)!;
  const url = quickCreateUrl(platform, { connectionId: "abc123def456", externalId: "opsfree-xyz" });

  it("opens CloudFormation quick-create in the topic's region", () => {
    expect(url.startsWith("https://console.aws.amazon.com/cloudformation/home?region=ap-south-1#/stacks/quickcreate?")).toBe(true);
  });

  it("pre-fills every parameter the template needs", () => {
    const q = new URLSearchParams(url.split("quickcreate?")[1]);
    expect(q.get("templateURL")).toBe(FULL_ENV.AWS_CONNECT_TEMPLATE_URL);
    expect(q.get("stackName")).toBe("OpsFreeSES-abc123def456");
    expect(q.get("param_ConnectionId")).toBe("abc123def456");
    expect(q.get("param_ExternalId")).toBe("opsfree-xyz");
    expect(q.get("param_PlatformPrincipalArn")).toBe(FULL_ENV.PLATFORM_AWS_PRINCIPAL_ARN);
    expect(q.get("param_CallbackTopicArn")).toBe(FULL_ENV.AWS_CONNECT_TOPIC_ARN);
  });

  it("carries no secret", () => {
    expect(url).not.toContain(FULL_ENV.PLATFORM_AWS_SECRET_ACCESS_KEY);
    expect(url).not.toContain(FULL_ENV.PLATFORM_AWS_ACCESS_KEY_ID);
  });
});

describe("role ARNs", () => {
  it("accepts only Ops-Free roles and returns their account", () => {
    expect(accountOfRoleArn(`arn:aws:iam::123456789012:role/${CONNECT_ROLE_PREFIX}abc123def456`)).toBe("123456789012");
  });

  it.each([
    "arn:aws:iam::123456789012:role/Admin",
    "arn:aws:iam::123456789012:user/OpsFreeSES-abc123def456",
    "arn:aws:iam::12345:role/OpsFreeSES-abc123def456",
    "arn:aws:iam::123456789012:role/path/OpsFreeSES-abc123def456",
    "not an arn",
    "",
  ])("rejects %s", (arn) => {
    expect(accountOfRoleArn(arn)).toBeNull();
  });
});

describe("CloudFormation's response URL", () => {
  it("accepts AWS's response buckets", () => {
    expect(
      isTrustedResponseUrl(
        "https://cloudformation-custom-resource-response-apsouth1.s3.ap-south-1.amazonaws.com/arn%3Aaws%3Acloudformation?X-Amz-Signature=abc",
      ),
    ).toBe(true);
  });

  it.each([
    "http://cloudformation-custom-resource-response-apsouth1.s3.ap-south-1.amazonaws.com/x",
    "https://evil.example.com/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "https://cloudformation-custom-resource-response-apsouth1.s3.ap-south-1.amazonaws.com.evil.com/x",
    "https://evil.com/cloudformation-custom-resource-response-x.s3.amazonaws.com/x",
    "https://s3.amazonaws.com/other-bucket/x",
  ])("refuses %s", (url) => {
    expect(isTrustedResponseUrl(url)).toBe(false);
  });

  it("never makes a request to an untrusted URL", async () => {
    await expect(putResponse("https://evil.example.com/x", "{}")).rejects.toThrow(/Untrusted/);
  });
});

describe("the custom-resource message", () => {
  const message = {
    RequestType: "Create",
    ResponseURL: "https://cloudformation-custom-resource-response-apsouth1.s3.ap-south-1.amazonaws.com/x?sig=1",
    StackId: "arn:aws:cloudformation:ap-south-1:123456789012:stack/OpsFreeSES-abc/uuid",
    RequestId: "req-1",
    LogicalResourceId: "TellOpsFree",
    ResourceProperties: {
      ServiceToken: "arn:aws:sns:ap-south-1:111122223333:ops-free-connect",
      ExternalId: "opsfree-xyz",
      RoleArn: "arn:aws:iam::123456789012:role/OpsFreeSES-abc123def456",
    },
  };

  it("parses what CloudFormation sends, ignoring extra fields", () => {
    const parsed = customResourceSchema.safeParse({ ...message, ResourceType: "Custom::OpsFreeConnect" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a message without an ExternalId or role", () => {
    expect(customResourceSchema.safeParse({ ...message, ResourceProperties: { RoleArn: "x" } }).success).toBe(false);
    expect(customResourceSchema.safeParse({ ...message, RequestType: "Nope" }).success).toBe(false);
  });

  it("answers with the identifiers CloudFormation requires", () => {
    const req = customResourceSchema.parse(message);
    const ok = buildResponse(req, "SUCCESS");
    expect(ok).toMatchObject({
      Status: "SUCCESS",
      StackId: message.StackId,
      RequestId: "req-1",
      LogicalResourceId: "TellOpsFree",
    });
    expect(ok.PhysicalResourceId).toBeTruthy();
    expect(buildResponse(req, "FAILED", "x".repeat(900)).Reason).toHaveLength(500);
    // A stable physical id across Create and Delete for one resource.
    const del = buildResponse({ ...req, RequestType: "Delete", PhysicalResourceId: ok.PhysicalResourceId }, "SUCCESS");
    expect(del.PhysicalResourceId).toBe(ok.PhysicalResourceId);
  });
});

describe("the CloudFormation template", () => {
  const yaml = buildConnectTemplate();

  it("grants exactly the actions the access-key option documents", () => {
    for (const action of [...REQUIRED_ACTIONS, ...EVENTS_ACTIONS, ...ROUTE53_ACTIONS]) {
      expect(yaml).toContain(`- ${action}`);
    }
    // Nothing broader: no wildcard actions, no admin policy.
    expect(yaml).not.toMatch(/Action:\s*"?\*"?\s*$/m);
    expect(yaml).not.toContain("AdministratorAccess");
    expect(yaml).not.toMatch(/- (ses|sns|route53|iam|sts):\*/);
  });

  it("trusts only the platform, and only with the ExternalId", () => {
    expect(yaml).toContain("AWS: !Ref PlatformPrincipalArn");
    expect(yaml).toContain("sts:ExternalId: !Ref ExternalId");
    expect(yaml).toContain("Action: sts:AssumeRole");
    expect(yaml).not.toMatch(/Principal:\s*"\*"/);
  });

  it("names the role with the prefix the platform may assume", () => {
    expect(yaml).toContain(`RoleName: !Sub "${CONNECT_ROLE_PREFIX}\${ConnectionId}"`);
  });

  it("reports the role back through the platform's topic", () => {
    expect(yaml).toContain("Type: Custom::OpsFreeConnect");
    expect(yaml).toContain("ServiceToken: !Ref CallbackTopicArn");
    expect(yaml).toContain("RoleArn: !GetAtt OpsFreeRole.Arn");
  });

  it("is plain readable YAML with no stray template placeholders", () => {
    expect(yaml).not.toContain("undefined");
    expect(yaml).not.toMatch(/\$\{(?!ConnectionId\})[A-Z_]+\}/);
    expect(yaml.startsWith('AWSTemplateFormatVersion: "2010-09-09"')).toBe(true);
  });
});

describe("platform configuration", () => {
  it("is off when nothing is set", () => {
    expect(platformAws({})).toBeNull();
    expect(oneClickConnectAvailable("you@example.com", {})).toBe(false);
  });

  it("derives the region and account from the topic", () => {
    const p = platformAws(FULL_ENV)!;
    expect(p.region).toBe("ap-south-1");
    expect(p.accountId).toBe("111122223333");
    expect(oneClickConnectAvailable("you@example.com", FULL_ENV)).toBe(true);
  });

  it("refuses a half-configured platform, naming fields but never values", () => {
    const partial = { ...FULL_ENV, AWS_CONNECT_TOPIC_ARN: "" };
    expect(() => platformAws(partial)).toThrow(PlatformAwsConfigError);
    try {
      platformAws(partial);
    } catch (e) {
      const text = String((e as Error).message);
      expect(text).toContain("AWS_CONNECT_TOPIC_ARN");
      expect(text).not.toContain(FULL_ENV.PLATFORM_AWS_SECRET_ACCESS_KEY);
    }
    // ...and hides the button instead of breaking the page.
    expect(oneClickConnectAvailable("you@example.com", partial)).toBe(false);
  });

  it.each([
    ["AWS_CONNECT_TEMPLATE_URL", "http://bucket.s3.amazonaws.com/x.yaml"],
    ["AWS_CONNECT_TEMPLATE_URL", "https://evil.example.com/x.yaml"],
    ["AWS_CONNECT_TOPIC_ARN", "arn:aws:sns:ap-south-1:1234:topic"],
    ["PLATFORM_AWS_PRINCIPAL_ARN", "arn:aws:iam::111122223333:root"],
  ])("rejects a bad %s", (key, value) => {
    expect(() => platformAws({ ...FULL_ENV, [key]: value })).toThrow(PlatformAwsConfigError);
  });
});

describe("the preview gate", () => {
  it("is open to everyone when no list is set", () => {
    expect(oneClickAllowedFor("anyone@example.com", {})).toBe(true);
    expect(oneClickAllowedFor(null, { AWS_CONNECT_PREVIEW_EMAILS: "" })).toBe(true);
  });

  it("limits the feature to the listed accounts, ignoring case and spacing", () => {
    const env = { AWS_CONNECT_PREVIEW_EMAILS: " Me@Example.com , other@example.com " };
    expect(oneClickAllowedFor("me@example.com", env)).toBe(true);
    expect(oneClickAllowedFor("OTHER@example.com", env)).toBe(true);
    expect(oneClickAllowedFor("friend@example.com", env)).toBe(false);
  });

  it("shows nothing to a signed-out or unknown account while the list is set", () => {
    expect(oneClickAllowedFor(null, { AWS_CONNECT_PREVIEW_EMAILS: "me@example.com" })).toBe(false);
    expect(oneClickAllowedFor(undefined, { AWS_CONNECT_PREVIEW_EMAILS: "me@example.com" })).toBe(false);
  });

  it("hides the button from everyone else even when the platform is configured", () => {
    const env = { ...FULL_ENV, AWS_CONNECT_PREVIEW_EMAILS: "me@example.com" };
    expect(oneClickConnectAvailable("me@example.com", env)).toBe(true);
    expect(oneClickConnectAvailable("friend@example.com", env)).toBe(false);
    expect(oneClickConnectAvailable("friend@example.com", FULL_ENV)).toBe(true);
  });
});

describe("credentials for an SDK client", () => {
  afterEach(() => __setAssumeForTests(null));

  it("passes access keys straight through, without a session token", () => {
    expect(awsCredentialsFor({ accessKeyId: "AKIA1", secretAccessKey: "s", region: "ap-south-1" })).toEqual({
      accessKeyId: "AKIA1",
      secretAccessKey: "s",
    });
  });

  const role = {
    roleArn: "arn:aws:iam::123456789012:role/OpsFreeSES-abc123def456",
    externalId: "opsfree-xyz",
    region: "ap-south-1",
    sessionName: "opsfree-12345678",
  };
  const session = (n: number, ttlMs: number, now: number) => ({
    accessKeyId: `ASIA${n}`,
    secretAccessKey: "secret",
    sessionToken: `token${n}`,
    expiration: new Date(now + ttlMs),
  });

  it("assumes the role with the ExternalId and session name", async () => {
    const assume = vi.fn<AssumeFn>(async () => session(1, 900_000, Date.now()));
    __setAssumeForTests(assume);
    const provider = awsCredentialsFor(role);
    expect(typeof provider).toBe("function");
    const creds = await (provider as () => Promise<{ accessKeyId: string }>)();
    expect(creds.accessKeyId).toBe("ASIA1");
    expect(assume).toHaveBeenCalledWith(role);
  });

  it("asks STS for the shortest session, so revoking cuts us off within minutes", () => {
    expect(SESSION_SECONDS).toBe(900);
  });

  it("reuses a live session rather than calling STS per email", async () => {
    const t0 = 1_000_000;
    const assume = vi.fn<AssumeFn>(async () => session(1, 900_000, t0));
    __setAssumeForTests(assume);
    await assumedCredentials(role, () => t0);
    await assumedCredentials(role, () => t0 + 60_000);
    await assumedCredentials(role, () => t0 + 700_000);
    expect(assume).toHaveBeenCalledTimes(1);
  });

  it("refreshes before the session expires", async () => {
    const t0 = 1_000_000;
    let n = 0;
    const assume = vi.fn<AssumeFn>(async () => session(++n, 900_000, t0));
    __setAssumeForTests(assume);
    await assumedCredentials(role, () => t0);
    // Less than two minutes left, so it must be replaced.
    const next = await assumedCredentials(role, () => t0 + 800_000);
    expect(assume).toHaveBeenCalledTimes(2);
    expect(next.accessKeyId).toBe("ASIA2");
  });

  it("shares one STS call between concurrent sends", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const assume = vi.fn<AssumeFn>(async () => {
      await gate;
      return session(1, 900_000, Date.now());
    });
    __setAssumeForTests(assume);
    const all = Promise.all([assumedCredentials(role), assumedCredentials(role), assumedCredentials(role)]);
    release();
    await all;
    expect(assume).toHaveBeenCalledTimes(1);
  });

  it("never serves one tenant's session to another role or ExternalId", async () => {
    const assume = vi.fn<AssumeFn>(async (input) => session(input.externalId === "a" ? 1 : 2, 900_000, Date.now()));
    __setAssumeForTests(assume);
    const a = await assumedCredentials({ ...role, externalId: "a" });
    const b = await assumedCredentials({ ...role, externalId: "b" });
    expect([a.accessKeyId, b.accessKeyId]).toEqual(["ASIA1", "ASIA2"]);
    expect(assume).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure", async () => {
    const assume = vi
      .fn<AssumeFn>()
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "AccessDenied" }))
      .mockResolvedValueOnce(session(1, 900_000, Date.now()));
    __setAssumeForTests(assume);
    await expect(assumedCredentials(role)).rejects.toThrow("denied");
    await expect(assumedCredentials(role)).resolves.toMatchObject({ accessKeyId: "ASIA1" });
  });
});
