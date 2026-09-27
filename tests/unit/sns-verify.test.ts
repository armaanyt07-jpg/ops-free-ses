import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isTrustedSnsUrl,
  snsEnvelopeSchema,
  stringToSign,
  TOPIC_ARN,
  type SnsEnvelope,
} from "@/lib/sns/message";

import {
  createSnsSigner,
  sesNotification,
  subscriptionConfirmation,
  type SnsSigner,
} from "../support/sns";

/**
 * SNS signature verification — SRS FR-5 step 1, Appendix B ("SNS signature
 * verification and idempotency are tested").
 *
 * Signing uses a real RSA key and a real X.509 certificate; only the HTTPS
 * fetch of that certificate is replaced.
 */
const fetchSigningCertificate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sns/certificate", () => ({ fetchSigningCertificate }));

const { verifySnsSignature } = await import("@/lib/sns/verify");

let signer: SnsSigner;

beforeAll(() => {
  signer = createSnsSigner();
});

beforeEach(() => {
  fetchSigningCertificate.mockReset();
  fetchSigningCertificate.mockResolvedValue(signer.certificate);
});

describe("stringToSign", () => {
  // Written out by hand from the AWS documentation rather than derived from
  // the implementation, so a mistake in the implementation cannot also be a
  // mistake in the expectation. The test signer uses the implementation; this
  // is what keeps that from being circular.
  const common = {
    MessageId: "id-1",
    TopicArn: "arn:aws:sns:us-east-1:123456789012:t",
    Message: "hello",
    Timestamp: "2026-09-27T00:00:00.000Z",
    SignatureVersion: "1" as const,
    Signature: "x",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/c.pem",
  };

  it("Notification with Subject", () => {
    expect(
      stringToSign({ ...common, Type: "Notification", Subject: "subj" }),
    ).toBe(
      "Message\nhello\nMessageId\nid-1\nSubject\nsubj\nTimestamp\n2026-09-27T00:00:00.000Z\nTopicArn\narn:aws:sns:us-east-1:123456789012:t\nType\nNotification\n",
    );
  });

  it("Notification without Subject omits the key entirely", () => {
    expect(stringToSign({ ...common, Type: "Notification" })).toBe(
      "Message\nhello\nMessageId\nid-1\nTimestamp\n2026-09-27T00:00:00.000Z\nTopicArn\narn:aws:sns:us-east-1:123456789012:t\nType\nNotification\n",
    );
  });

  it("SubscriptionConfirmation includes SubscribeURL and Token", () => {
    expect(
      stringToSign({
        ...common,
        Type: "SubscriptionConfirmation",
        Token: "tok",
        SubscribeURL: "https://sns.us-east-1.amazonaws.com/?x",
      }),
    ).toBe(
      "Message\nhello\nMessageId\nid-1\nSubscribeURL\nhttps://sns.us-east-1.amazonaws.com/?x\nTimestamp\n2026-09-27T00:00:00.000Z\nToken\ntok\nTopicArn\narn:aws:sns:us-east-1:123456789012:t\nType\nSubscriptionConfirmation\n",
    );
  });
});

describe("isTrustedSnsUrl", () => {
  it.each([
    "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
    "https://sns.eu-west-2.amazonaws.com/x.pem",
    "https://sns.cn-north-1.amazonaws.com.cn/x.pem",
    "https://sns.us-east-1.amazonaws.com:443/x.pem",
  ])("trusts %s", (url) => {
    expect(isTrustedSnsUrl(url, { requirePem: true })).toBe(true);
  });

  it.each([
    ["plain http", "http://sns.us-east-1.amazonaws.com/x.pem"],
    ["attacker host", "https://evil.example.com/x.pem"],
    ["lookalike suffix", "https://sns.us-east-1.amazonaws.com.evil.com/x.pem"],
    ["lookalike prefix", "https://evilsns.us-east-1.amazonaws.com/x.pem"],
    ["other AWS service", "https://s3.us-east-1.amazonaws.com/x.pem"],
    ["non-standard port", "https://sns.us-east-1.amazonaws.com:8443/x.pem"],
    ["userinfo", "https://a@sns.us-east-1.amazonaws.com/x.pem"],
    ["not a .pem", "https://sns.us-east-1.amazonaws.com/x.txt"],
    ["internal address", "https://169.254.169.254/x.pem"],
    ["not a URL", "sns.us-east-1.amazonaws.com/x.pem"],
  ])("rejects %s", (_label, url) => {
    expect(isTrustedSnsUrl(url, { requirePem: true })).toBe(false);
  });
});

describe("TOPIC_ARN", () => {
  it("accepts standard topics, rejects FIFO and other services", () => {
    expect(TOPIC_ARN.test("arn:aws:sns:us-east-1:123456789012:ses-events")).toBe(true);
    expect(TOPIC_ARN.test("arn:aws-cn:sns:cn-north-1:123456789012:t")).toBe(true);
    expect(TOPIC_ARN.test("arn:aws:sns:us-east-1:123456789012:t.fifo")).toBe(false);
    expect(TOPIC_ARN.test("arn:aws:sqs:us-east-1:123456789012:q")).toBe(false);
    expect(TOPIC_ARN.test("arn:aws:sns:us-east-1:12345:t")).toBe(false);
  });
});

describe("verifySnsSignature", () => {
  it("accepts a genuine SignatureVersion 1 (SHA-1) notification", async () => {
    const msg = sesNotification(signer, { notificationType: "Delivery" });
    expect(await verifySnsSignature(msg)).toEqual({ ok: true });
  });

  it("accepts a genuine SignatureVersion 2 (SHA-256) notification", async () => {
    const msg = sesNotification(signer, { notificationType: "Delivery" }, { version: "2" });
    expect(await verifySnsSignature(msg)).toEqual({ ok: true });
  });

  it("accepts a genuine subscription confirmation", async () => {
    expect(await verifySnsSignature(subscriptionConfirmation(signer))).toEqual({
      ok: true,
    });
  });

  it("accepts a notification that has a Subject", async () => {
    const msg = signer.sign({
      ...sesNotification(signer, {}),
      Subject: "Amazon SES Email Event Notification",
    });
    expect(await verifySnsSignature(msg)).toEqual({ ok: true });
  });

  it.each([
    ["Message", { Message: '{"notificationType":"Bounce"}' }],
    ["MessageId", { MessageId: "other-id" }],
    ["TopicArn", { TopicArn: "arn:aws:sns:us-east-1:999999999999:other" }],
    ["Timestamp", { Timestamp: "2020-01-01T00:00:00.000Z" }],
    ["Subject (added)", { Subject: "injected" }],
  ])("rejects a notification whose %s was altered", async (_field, change) => {
    const msg = { ...sesNotification(signer, { notificationType: "Delivery" }), ...change };
    expect(await verifySnsSignature(msg as SnsEnvelope)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a SubscribeURL swapped after signing", async () => {
    const msg = {
      ...subscriptionConfirmation(signer),
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=evil",
    };
    expect((await verifySnsSignature(msg)).ok).toBe(false);
  });

  it("rejects a signature made with a different key", async () => {
    const other = createSnsSigner();
    const msg = other.sign({ ...sesNotification(signer, {}), SigningCertURL: signer.certUrl });
    expect(await verifySnsSignature(msg)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a v1 signature presented as v2", async () => {
    const msg = { ...sesNotification(signer, {}, { version: "1" }), SignatureVersion: "2" as const };
    expect((await verifySnsSignature(msg)).ok).toBe(false);
  });

  it("rejects garbage in the Signature field without throwing", async () => {
    const msg = { ...sesNotification(signer, {}), Signature: "not base64 !!" };
    expect((await verifySnsSignature(msg)).ok).toBe(false);
  });

  it("never fetches a certificate from an untrusted URL", async () => {
    const msg = { ...sesNotification(signer, {}), SigningCertURL: "https://evil.example.com/cert.pem" };
    expect(await verifySnsSignature(msg)).toEqual({ ok: false, reason: "untrusted_cert_url" });
    expect(fetchSigningCertificate).not.toHaveBeenCalled();
  });

  it("rejects when the certificate cannot be fetched", async () => {
    fetchSigningCertificate.mockRejectedValue(new Error("network"));
    expect(await verifySnsSignature(sesNotification(signer, {}))).toEqual({
      ok: false,
      reason: "cert_unavailable",
    });
  });

  it("rejects outside the certificate's validity window", async () => {
    const msg = sesNotification(signer, {});
    const later = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    expect(await verifySnsSignature(msg, later)).toEqual({
      ok: false,
      reason: "cert_expired",
    });
  });
});

describe("snsEnvelopeSchema", () => {
  it("requires SubscribeURL and Token on confirmations", () => {
    const { SubscribeURL: _omit, ...rest } = subscriptionConfirmation(signer);
    expect(snsEnvelopeSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an unknown Type", () => {
    const msg = { ...sesNotification(signer, {}), Type: "Other" };
    expect(snsEnvelopeSchema.safeParse(msg).success).toBe(false);
  });

  it("rejects a raw SES event (raw message delivery enabled)", () => {
    expect(
      snsEnvelopeSchema.safeParse({ notificationType: "Bounce", bounce: {} }).success,
    ).toBe(false);
  });
});
