import { randomBytes } from "node:crypto";
import { request } from "node:https";

import { z } from "zod";

import { CONNECT_ROLE_PREFIX } from "@/lib/aws/connect-template";
import type { PlatformAws } from "@/lib/aws/platform";

/**
 * Pure pieces of the one-click connect flow (Phase 10): minting the id the role
 * trusts, building the console link, reading CloudFormation's callback and
 * answering it. No database, no AWS SDK, so each is unit-testable.
 */

/** How long a click stays valid. CloudFormation finishes in a couple of minutes. */
export const CONNECTION_TTL_MS = 2 * 60 * 60 * 1000;

/** The id the role's trust policy demands. Ours to mint, never the customer's. */
export function newExternalId(): string {
  return `opsfree-${randomBytes(24).toString("base64url")}`;
}

/** A short, unique, URL-safe handle for the role and stack name. */
export function newConnectionId(): string {
  return randomBytes(6).toString("hex");
}

export function quickCreateUrl(
  platform: PlatformAws,
  p: { connectionId: string; externalId: string },
): string {
  const params = new URLSearchParams({
    templateURL: platform.templateUrl,
    stackName: `OpsFreeSES-${p.connectionId}`,
    param_ConnectionId: p.connectionId,
    param_ExternalId: p.externalId,
    param_PlatformPrincipalArn: platform.principalArn,
    param_CallbackTopicArn: platform.topicArn,
  });
  // Quick-create links carry their parameters after the `#`. The stack must run
  // in the topic's region: CloudFormation only calls a same-region SNS token.
  return `https://console.aws.amazon.com/cloudformation/home?region=${platform.region}#/stacks/quickcreate?${params.toString()}`;
}

const ROLE_ARN = new RegExp(`^arn:aws:iam::(\\d{12}):role/${CONNECT_ROLE_PREFIX}[A-Za-z0-9]{6,32}$`);

/** The 12-digit account a role ARN belongs to, if it is one of ours. */
export function accountOfRoleArn(arn: string): string | null {
  return ROLE_ARN.exec(arn)?.[1] ?? null;
}

/** What CloudFormation puts in the SNS message for a custom resource. */
export const customResourceSchema = z.object({
  RequestType: z.enum(["Create", "Update", "Delete"]),
  ResponseURL: z.string().url(),
  StackId: z.string().min(1),
  RequestId: z.string().min(1),
  LogicalResourceId: z.string().min(1),
  PhysicalResourceId: z.string().optional(),
  ResourceProperties: z.object({
    ExternalId: z.string().min(1),
    RoleArn: z.string().min(1),
  }),
});
export type CustomResourceRequest = z.infer<typeof customResourceSchema>;

/**
 * CloudFormation's presigned S3 response URLs. The body of the SNS message is
 * attacker-influenced until proven otherwise, and we make a server-side PUT to
 * this URL, so it must be an AWS response bucket and nothing else.
 */
const RESPONSE_URL =
  /^https:\/\/cloudformation-custom-resource-response-[a-z0-9-]+\.s3[.-][a-z0-9.-]*amazonaws\.com(\.cn)?\/[^\s]+$/;

export function isTrustedResponseUrl(url: string): boolean {
  return RESPONSE_URL.test(url);
}

export interface CustomResourceResponse {
  Status: "SUCCESS" | "FAILED";
  Reason?: string;
  PhysicalResourceId: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  Data?: Record<string, string>;
}

export function buildResponse(
  req: CustomResourceRequest,
  status: "SUCCESS" | "FAILED",
  reason?: string,
): CustomResourceResponse {
  return {
    Status: status,
    ...(reason ? { Reason: reason.slice(0, 500) } : {}),
    // Must be stable across Create/Update/Delete for one resource.
    PhysicalResourceId: req.PhysicalResourceId ?? `opsfree-${req.ResourceProperties.ExternalId.slice(-12)}`,
    StackId: req.StackId,
    RequestId: req.RequestId,
    LogicalResourceId: req.LogicalResourceId,
  };
}

export type PutResponseFn = (url: string, body: string) => Promise<void>;

/**
 * PUTs the answer to CloudFormation's presigned URL. node:https, not fetch:
 * the URL is signed with an empty Content-Type, and fetch would add one.
 */
export const putResponse: PutResponseFn = (url, body) =>
  new Promise((resolve, reject) => {
    if (!isTrustedResponseUrl(url)) {
      reject(new Error("Untrusted CloudFormation response URL"));
      return;
    }
    const target = new URL(url);
    const req = request(
      {
        method: "PUT",
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        headers: { "content-type": "", "content-length": Buffer.byteLength(body) },
        timeout: 10_000,
      },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`CloudFormation response URL answered HTTP ${res.statusCode}`));
      },
    );
    req.on("timeout", () => req.destroy(new Error("CloudFormation response URL timed out")));
    req.on("error", reject);
    req.end(body);
  });
