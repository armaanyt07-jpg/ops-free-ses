import { verify } from "node:crypto";

import { fetchSigningCertificate } from "./certificate";
import { isTrustedSnsUrl, stringToSign, type SnsEnvelope } from "./message";

/**
 * SNS message authenticity — SRS FR-5 step 1, §9.
 *
 * The webhook is a public, unauthenticated URL. The only thing distinguishing a
 * genuine SES bounce from a forged one — which would suppress an arbitrary
 * recipient or rewrite a message's status — is this signature.
 *
 *   1. The certificate URL must be HTTPS on an SNS host, and end in `.pem`.
 *      Checked *before* fetching, so a forged message cannot point the
 *      verifier at a certificate the attacker controls.
 *   2. The certificate must be currently valid.
 *   3. The signature must verify over the canonical string, using SHA-1 for
 *      SignatureVersion 1 and SHA-256 for SignatureVersion 2.
 *
 * TLS to the SNS host is what authenticates the certificate itself; the chain
 * is not re-validated here.
 */
export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "untrusted_cert_url"
        | "cert_unavailable"
        | "cert_expired"
        | "bad_signature";
    };

export async function verifySnsSignature(
  message: SnsEnvelope,
  now: Date = new Date(),
): Promise<VerifyResult> {
  if (!isTrustedSnsUrl(message.SigningCertURL, { requirePem: true })) {
    return { ok: false, reason: "untrusted_cert_url" };
  }

  let certificate;
  try {
    certificate = await fetchSigningCertificate(message.SigningCertURL);
  } catch {
    return { ok: false, reason: "cert_unavailable" };
  }

  if (
    now < new Date(certificate.validFrom) ||
    now > new Date(certificate.validTo)
  ) {
    return { ok: false, reason: "cert_expired" };
  }

  const algorithm = message.SignatureVersion === "1" ? "sha1" : "sha256";

  let valid = false;
  try {
    valid = verify(
      algorithm,
      Buffer.from(stringToSign(message), "utf8"),
      certificate.publicKey,
      Buffer.from(message.Signature, "base64"),
    );
  } catch {
    valid = false;
  }

  return valid ? { ok: true } : { ok: false, reason: "bad_signature" };
}
