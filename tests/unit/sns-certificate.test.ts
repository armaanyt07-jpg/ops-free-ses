import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fetchSigningCertificate } from "@/lib/sns/certificate";
import { confirmSubscription } from "@/lib/sns/subscription";

import { createSnsSigner, type SnsSigner } from "../support/sns";

/**
 * The two outbound fetches the webhook makes — the signing certificate and the
 * subscription confirmation. Both take a URL from a request body, so both
 * must refuse to go anywhere but SNS, and must not follow redirects off it.
 */
let signer: SnsSigner;
const fetchMock = vi.fn();

beforeAll(() => {
  signer = createSnsSigner();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("fetchSigningCertificate", () => {
  it("fetches, parses and caches the certificate", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(signer.certPem));

    const url = "https://sns.us-east-1.amazonaws.com/cache-test.pem";
    const first = await fetchSigningCertificate(url);
    const second = await fetchSigningCertificate(url);

    expect(first.fingerprint256).toBe(signer.certificate.fingerprint256);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it("refuses an untrusted URL without making a request", async () => {
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchSigningCertificate("https://evil.example.com/x.pem"),
    ).rejects.toThrow(/Untrusted/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not an X.509 certificate", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("<html>not a cert</html>"));
    await expect(
      fetchSigningCertificate("https://sns.us-east-1.amazonaws.com/bad.pem"),
    ).rejects.toThrow(/not valid X.509/);
  });

  it("rejects a non-2xx response", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    await expect(
      fetchSigningCertificate("https://sns.us-east-1.amazonaws.com/missing.pem"),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("confirmSubscription", () => {
  it("visits the SubscribeURL and extracts the subscription ARN", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        "<ConfirmSubscriptionResponse><ConfirmSubscriptionResult><SubscriptionArn>arn:aws:sns:us-east-1:123456789012:t:abc</SubscriptionArn></ConfirmSubscriptionResult></ConfirmSubscriptionResponse>",
      ),
    );

    const result = await confirmSubscription(
      "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=x",
    );
    expect(result.subscriptionArn).toBe("arn:aws:sns:us-east-1:123456789012:t:abc");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it.each([
    "http://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
    "https://169.254.169.254/latest/meta-data/",
    "https://internal.example.com/admin",
  ])("refuses to visit %s", async (url) => {
    vi.stubGlobal("fetch", fetchMock);
    await expect(confirmSubscription(url)).rejects.toThrow(/Untrusted/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a non-2xx so the webhook answers 5xx and SNS retries", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    await expect(
      confirmSubscription("https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription"),
    ).rejects.toThrow(/HTTP 403/);
  });
});

describe("negative cache (Phase 7)", () => {
  it("remembers a definitive failure, so a forged URL costs one fetch, not one per message", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const url = "https://sns.us-east-1.amazonaws.com/forged-once.pem";
    await expect(fetchSigningCertificate(url)).rejects.toThrow(/HTTP 404/);
    await expect(fetchSigningCertificate(url)).rejects.toThrow(/recently unavailable/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never caches a transient failure — SNS retries must get a real second attempt", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const url = "https://sns.us-east-1.amazonaws.com/transient.pem";
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(fetchSigningCertificate(url)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(fetchSigningCertificate(url)).rejects.toThrow(/HTTP 503/);
    fetchMock.mockResolvedValueOnce(new Response(signer.certPem));
    await expect(fetchSigningCertificate(url)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
