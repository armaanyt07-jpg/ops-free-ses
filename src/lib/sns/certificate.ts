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

/**
 * Definitive failures are remembered too (Phase 7). Without this, every forged
 * message naming a *different* nonexistent `.pem` on the SNS host costs one
 * outbound HTTPS request — an attacker-driven amplification.
 *
 * Only *definitive* failures are cached: a 4xx from the SNS host, or a body
 * that is not a certificate — i.e. the URL is wrong. Timeouts, network errors
 * and 5xx are transient and never cached: SNS's default HTTP policy retries
 * for only about a minute, and caching a transient blip across those retries
 * would drop a genuine bounce.
 */
const FAILURE_TTL_MS = 5 * 60 * 1000;
const failures = new Map<string, number>();

export class CertificateFetchError extends Error {
  /** True when retrying the same URL cannot succeed. */
  readonly definitive: boolean;
  constructor(message: string, definitive = false) {
    super(message);
    this.name = "CertificateFetchError";
    this.definitive = definitive;
  }
}

export async function fetchSigningCertificate(
  url: string,
): Promise<X509Certificate> {
  const cached = cache.get(url);
  if (cached) return cached;

  const failedAt = failures.get(url);
  if (failedAt !== undefined && Date.now() - failedAt < FAILURE_TTL_MS) {
    throw new CertificateFetchError("Signing certificate recently unavailable");
  }

  try {
    return await fetchAndCache(url);
  } catch (error) {
    if (error instanceof CertificateFetchError && error.definitive) {
      if (failures.size >= 1_000) failures.delete(failures.keys().next().value!);
      failures.set(url, Date.now());
    }
    throw error;
  }
}

async function fetchAndCache(url: string): Promise<X509Certificate> {

  if (!isTrustedSnsUrl(url, { requirePem: true })) {
    throw new CertificateFetchError("Untrusted signing certificate URL", true);
  }

  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new CertificateFetchError(
      `Signing certificate fetch returned HTTP ${response.status}`,
      response.status >= 400 && response.status < 500,
    );
  }

  const body = await response.text();
  if (body.length > MAX_CERT_BYTES) {
    throw new CertificateFetchError("Signing certificate is implausibly large", true);
  }

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(body);
  } catch {
    throw new CertificateFetchError("Signing certificate is not valid X.509", true);
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, certificate);

  return certificate;
}
