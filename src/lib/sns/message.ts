import { z } from "zod";

/**
 * The SNS HTTP/S message envelope.
 *
 * SNS posts one of three envelope types (SRS §7). Every field that participates
 * in the signature is required by the schema for the types that sign it, so a
 * message missing one is rejected as malformed before verification is tried.
 */
export const SNS_MESSAGE_TYPES = [
  "Notification",
  "SubscriptionConfirmation",
  "UnsubscribeConfirmation",
] as const;

export type SnsMessageType = (typeof SNS_MESSAGE_TYPES)[number];

const base = {
  MessageId: z.string().min(1).max(128),
  TopicArn: z.string().min(1).max(320),
  Message: z.string(),
  Timestamp: z.string().min(1),
  SignatureVersion: z.enum(["1", "2"]),
  Signature: z.string().min(1),
  SigningCertURL: z.string().min(1),
};

const notification = z.object({
  ...base,
  Type: z.literal("Notification"),
  Subject: z.string().optional(),
  UnsubscribeURL: z.string().optional(),
});

const subscriptionFields = {
  ...base,
  Token: z.string().min(1),
  SubscribeURL: z.string().min(1),
};

// Two members with literal types, not one with an enum, so TypeScript can
// narrow each branch of the webhook's `Type` switch.
export const snsEnvelopeSchema = z.discriminatedUnion("Type", [
  notification,
  z.object({ ...subscriptionFields, Type: z.literal("SubscriptionConfirmation") }),
  z.object({ ...subscriptionFields, Type: z.literal("UnsubscribeConfirmation") }),
]);

export type SnsEnvelope = z.infer<typeof snsEnvelopeSchema>;

/**
 * The canonical string SNS signs.
 *
 * Fixed key order, each as `Key\nValue\n`. `Subject` is included only when the
 * message has one — an absent Subject is omitted entirely, not signed as an
 * empty string. Getting either detail wrong makes every genuine message fail
 * verification.
 *
 * https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 */
export function stringToSign(message: SnsEnvelope): string {
  const pairs: Array<[string, string]> =
    message.Type === "Notification"
      ? [
          ["Message", message.Message],
          ["MessageId", message.MessageId],
          ...(message.Subject !== undefined
            ? ([["Subject", message.Subject]] as Array<[string, string]>)
            : []),
          ["Timestamp", message.Timestamp],
          ["TopicArn", message.TopicArn],
          ["Type", message.Type],
        ]
      : [
          ["Message", message.Message],
          ["MessageId", message.MessageId],
          ["SubscribeURL", message.SubscribeURL],
          ["Timestamp", message.Timestamp],
          ["Token", message.Token],
          ["TopicArn", message.TopicArn],
          ["Type", message.Type],
        ];

  return pairs.map(([key, value]) => `${key}\n${value}\n`).join("");
}

/**
 * Hosts SNS legitimately serves from: `sns.<region>.amazonaws.com`, plus the
 * China partition. Applied to both the signing certificate URL and the
 * SubscribeURL, because both are attacker-supplied until the signature is
 * checked — and the SubscribeURL is fetched by the server.
 */
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function isTrustedSnsUrl(
  raw: string,
  { requirePem = false }: { requirePem?: boolean } = {},
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.port !== "" && url.port !== "443") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (!SNS_HOST.test(url.hostname)) return false;
  if (requirePem && !url.pathname.endsWith(".pem")) return false;

  return true;
}

/** Standard (non-FIFO) SNS topic ARN. SES cannot publish to FIFO topics. */
export const TOPIC_ARN = /^arn:aws(-cn|-us-gov)?:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/;

/** The region segment of a topic ARN. */
export function topicRegion(arn: string): string | null {
  return arn.split(":")[3] ?? null;
}
