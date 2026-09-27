import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, sign, X509Certificate } from "node:crypto";

import { stringToSign, type SnsEnvelope } from "@/lib/sns/message";

/**
 * A stand-in for SNS's signing key.
 *
 * A real RSA key and a real self-signed X.509 certificate, made by `openssl`,
 * so the verifier runs its production path — parse the certificate, check its
 * validity window, verify with its public key — rather than a shortcut that
 * takes a bare public key.
 */
export interface SnsSigner {
  certificate: X509Certificate;
  certPem: string;
  certUrl: string;
  sign<T extends Omit<SnsEnvelope, "Signature">>(
    envelope: T,
  ): T & { Signature: string };
}

export function createSnsSigner(): SnsSigner {
  const dir = mkdtempSync(join(tmpdir(), "ops-sns-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-days",
        "2",
        "-subj",
        "/CN=sns.amazonaws.com",
      ],
      { stdio: "ignore" },
    );

    const keyPem = readFileSync(join(dir, "key.pem"), "utf8");
    const certPem = readFileSync(join(dir, "cert.pem"), "utf8");

    return {
      certPem,
      certificate: new X509Certificate(certPem),
      certUrl: `https://sns.us-east-1.amazonaws.com/SimpleNotificationService-${randomUUID().slice(0, 8)}.pem`,
      sign(envelope) {
        const algorithm = envelope.SignatureVersion === "1" ? "sha1" : "sha256";
        const signature = sign(
          algorithm,
          Buffer.from(stringToSign({ ...envelope, Signature: "" } as SnsEnvelope), "utf8"),
          keyPem,
        ).toString("base64");
        return { ...envelope, Signature: signature };
      },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const TEST_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:ses-events";

/** A signed Notification envelope carrying an SES event. */
export function sesNotification(
  signer: SnsSigner,
  sesEvent: Record<string, unknown>,
  {
    topicArn = TEST_TOPIC_ARN,
    messageId = randomUUID(),
    version = "1",
  }: { topicArn?: string; messageId?: string; version?: "1" | "2" } = {},
) {
  return signer.sign({
    Type: "Notification" as const,
    MessageId: messageId,
    TopicArn: topicArn,
    Message: JSON.stringify(sesEvent),
    Timestamp: new Date().toISOString(),
    SignatureVersion: version,
    SigningCertURL: signer.certUrl,
    UnsubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=${topicArn}:sub`,
  });
}

export function subscriptionConfirmation(
  signer: SnsSigner,
  {
    topicArn = TEST_TOPIC_ARN,
    messageId = randomUUID(),
    type = "SubscriptionConfirmation",
    subscribeUrl = `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${topicArn}&Token=tok`,
  }: {
    topicArn?: string;
    messageId?: string;
    type?: "SubscriptionConfirmation" | "UnsubscribeConfirmation";
    subscribeUrl?: string;
  } = {},
) {
  return signer.sign({
    Type: type,
    MessageId: messageId,
    TopicArn: topicArn,
    Message: "You have chosen to subscribe to the topic.",
    Timestamp: new Date().toISOString(),
    SignatureVersion: "1" as const,
    SigningCertURL: signer.certUrl,
    Token: "tok",
    SubscribeURL: subscribeUrl,
  });
}

/** SES event bodies, in the identity-notification (`notificationType`) form. */
export const sesEvents = {
  bounce(
    sesMessageId: string,
    recipients: string[],
    bounceType: "Permanent" | "Transient" | "Undetermined" = "Permanent",
  ) {
    return {
      notificationType: "Bounce",
      bounce: {
        bounceType,
        bounceSubType: bounceType === "Permanent" ? "General" : "MailboxFull",
        bouncedRecipients: recipients.map((emailAddress) => ({
          emailAddress,
          action: "failed",
          status: "5.1.1",
          diagnosticCode: "smtp; 550 5.1.1 user unknown",
        })),
        timestamp: new Date(Date.now() - 2_000).toISOString(),
        feedbackId: `fb-${randomUUID()}`,
      },
      mail: mail(sesMessageId, recipients),
    };
  },
  complaint(sesMessageId: string, recipients: string[]) {
    return {
      notificationType: "Complaint",
      complaint: {
        complainedRecipients: recipients.map((emailAddress) => ({ emailAddress })),
        complaintFeedbackType: "abuse",
        timestamp: new Date(Date.now() - 2_000).toISOString(),
        feedbackId: `fb-${randomUUID()}`,
      },
      mail: mail(sesMessageId, recipients),
    };
  },
  delivery(sesMessageId: string, recipients: string[]) {
    return {
      notificationType: "Delivery",
      delivery: {
        recipients,
        timestamp: new Date(Date.now() - 2_000).toISOString(),
        processingTimeMillis: 812,
        smtpResponse: "250 2.0.0 OK",
      },
      mail: mail(sesMessageId, recipients),
    };
  },
};

function mail(messageId: string, destination: string[]) {
  return {
    messageId,
    timestamp: new Date(Date.now() - 5_000).toISOString(),
    source: "sender@example.com",
    destination,
    // Present in real notifications; must never be persisted.
    commonHeaders: { subject: "Secret subject line", from: ["sender@example.com"] },
    headers: [{ name: "Subject", value: "Secret subject line" }],
  };
}
