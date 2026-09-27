import { X509Certificate } from "node:crypto";

import { isTrustedSnsUrl } from "./message";

/**
 * Fetches an SNS signing certificate.
 *
 * The URL has already been checked by `isTrustedSnsUrl` in the verifier, and is
 * checked again here so this function is safe on its own. Redirects are
 * refused: a redirect off the SNS host would defeat the host check.
 *
 * Certificates are cached per URL. SNS rotates them rarely, and without a cache
 * every webhook call would add an outbound HTTPS round trip — and a flood of
 * forged messages would become a flood of fetches.
 */
const MAX_CERT_BYTES = 16 * 1024;
const MAX_CACHE_ENTRIES = 50;

const cache = new Map<string, X509Certificate>();

export class CertificateFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertificateFetchError";
  }
}

export async function fetchSigningCertificate(
  url: string,
): Promise<X509Certificate> {
  const cached = cache.get(url);
  if (cached) return cached;

  if (!isTrustedSnsUrl(url, { requirePem: true })) {
    throw new CertificateFetchError("Untrusted signing certificate URL");
  }

  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new CertificateFetchError(
      `Signing certificate fetch returned HTTP ${response.status}`,
    );
  }

  const body = await response.text();
  if (body.length > MAX_CERT_BYTES) {
    throw new CertificateFetchError("Signing certificate is implausibly large");
  }

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(body);
  } catch {
    throw new CertificateFetchError("Signing certificate is not valid X.509");
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, certificate);

  return certificate;
}
