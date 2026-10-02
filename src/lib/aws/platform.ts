/**
 * The platform's own AWS identity and the pieces of the one-click "Connect AWS"
 * flow that live in the operator's AWS account (Phase 10).
 *
 * Everything here is optional. Without it the dashboard offers only the
 * access-key connection, exactly as before, so a local checkout or a test run
 * needs no AWS account of its own. Set all of it, or none: a half-configured
 * flow would fail halfway through a customer's click.
 *
 * `PLATFORM_AWS_*` is an IAM user that can do one thing: `sts:AssumeRole` on
 * roles named `OpsFreeSES-*`. Its keys are long-lived secrets of ours; they
 * live only in Vercel and the worker's environment, never in the repo.
 */
import { z } from "zod";

const TOPIC_ARN = /^arn:aws:sns:([a-z0-9-]+):(\d{12}):[A-Za-z0-9_-]{1,256}$/;
const PRINCIPAL_ARN = /^arn:aws:iam::\d{12}:(user|role)\/[\w+=,.@/-]{1,512}$/;

const schema = z.object({
  PLATFORM_AWS_ACCESS_KEY_ID: z.string().min(16),
  PLATFORM_AWS_SECRET_ACCESS_KEY: z.string().min(16),
  /** The IAM identity customers' roles trust. Must match the keys above. */
  PLATFORM_AWS_PRINCIPAL_ARN: z.string().regex(PRINCIPAL_ARN, "must be an IAM user or role ARN"),
  /** S3 URL of the published CloudFormation template (see scripts/aws-connect-publish.ts). */
  AWS_CONNECT_TEMPLATE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://") && /\.amazonaws\.com\//.test(u), "must be an https S3 URL"),
  /** SNS topic the stack's custom resource notifies. Its region is the stack region. */
  AWS_CONNECT_TOPIC_ARN: z.string().regex(TOPIC_ARN, "must be an SNS topic ARN"),
});

export interface PlatformAws {
  accessKeyId: string;
  secretAccessKey: string;
  principalArn: string;
  templateUrl: string;
  topicArn: string;
  /** Region of the topic. CloudFormation requires the stack to run here. */
  region: string;
  accountId: string;
}

export class PlatformAwsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformAwsConfigError";
  }
}

const KEYS = Object.keys(schema.shape) as Array<keyof typeof schema.shape>;

/** Null when none of it is set (feature off). Throws if only some is. */
export function platformAws(env: Record<string, string | undefined> = process.env): PlatformAws | null {
  const present = KEYS.filter((k) => (env[k] ?? "").trim() !== "");
  if (present.length === 0) return null;

  const parsed = schema.safeParse(Object.fromEntries(KEYS.map((k) => [k, env[k]?.trim()])));
  if (!parsed.success) {
    // Names only: values are secrets.
    const bad = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new PlatformAwsConfigError(`One-click AWS connect is half-configured — ${bad}`);
  }

  const v = parsed.data;
  const topic = TOPIC_ARN.exec(v.AWS_CONNECT_TOPIC_ARN)!;
  return {
    accessKeyId: v.PLATFORM_AWS_ACCESS_KEY_ID,
    secretAccessKey: v.PLATFORM_AWS_SECRET_ACCESS_KEY,
    principalArn: v.PLATFORM_AWS_PRINCIPAL_ARN,
    templateUrl: v.AWS_CONNECT_TEMPLATE_URL,
    topicArn: v.AWS_CONNECT_TOPIC_ARN,
    region: topic[1]!,
    accountId: topic[2]!,
  };
}

/** Whether the dashboard should offer the one-click button. */
export function oneClickConnectAvailable(env: Record<string, string | undefined> = process.env): boolean {
  try {
    return platformAws(env) !== null;
  } catch {
    // Half-configured: hide the button rather than break the page. The error
    // surfaces in the logs the first time anything tries to use it.
    return false;
  }
}
