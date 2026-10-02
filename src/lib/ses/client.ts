import "server-only";

import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetAccountCommand,
  GetEmailIdentityCommand,
  SendEmailCommand,
  type DkimAttributes,
  type SendEmailCommandOutput,
} from "@aws-sdk/client-sesv2";

import { awsCredentialsFor } from "@/lib/aws/credentials";

/**
 * AWS SES access, using the customer's own credentials (SRS §2: the delivery
 * plane stays in the customer's AWS account).
 *
 * Clients are constructed per operation from a decrypted credential and are
 * never cached, so a revoked or rotated key takes effect on the next send
 * rather than living on in a warm Lambda.
 */
export interface KeyCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  roleArn?: undefined;
}

/**
 * A customer-side IAM role the platform assumes (Phase 10, one-click connect).
 * No secret is stored: `awsCredentialsFor` exchanges the platform's own
 * identity for short-lived credentials, proving the `externalId` the role's
 * trust policy demands.
 */
export interface RoleCredentials {
  roleArn: string;
  externalId: string;
  region: string;
  /** Shows up in the customer's CloudTrail so they can tell who acted. */
  sessionName: string;
  accessKeyId?: undefined;
  secretAccessKey?: undefined;
}

export type SesCredentials = KeyCredentials | RoleCredentials;

export interface SesAccountSnapshot {
  /** False while the account is still in the SES sandbox. */
  productionAccessEnabled: boolean;
  /** Configured maximum send rate in emails/second, when reported. */
  maxSendRate: number | null;
  max24HourSend: number | null;
  sentLast24Hours: number | null;
  /** AWS reputation enforcement status, e.g. "HEALTHY". */
  enforcementStatus: string | null;
  /**
   * AWS's own status for the latest production-access review — PENDING,
   * GRANTED, DENIED or FAILED — exactly as reported; null if never requested.
   * The only approval status this platform ever displays.
   */
  reviewStatus?: string | null;
  reviewCaseId?: string | null;
}

export function createSesClient(credentials: SesCredentials): SESv2Client {
  return new SESv2Client({
    region: credentials.region,
    credentials: awsCredentialsFor(credentials),
    maxAttempts: 3,
  });
}

/**
 * Server-side credential validation (SRS FR-1: "Validate credentials through a
 * server-side AWS call"). GetAccount is the cheapest authenticated SES call
 * and doubles as the sandbox/quota snapshot the dashboard needs.
 */
export async function describeSesAccount(
  credentials: SesCredentials,
): Promise<SesAccountSnapshot> {
  const client = createSesClient(credentials);

  try {
    const account = await client.send(new GetAccountCommand({}));

    return {
      productionAccessEnabled: account.ProductionAccessEnabled ?? false,
      maxSendRate: account.SendQuota?.MaxSendRate ?? null,
      max24HourSend: account.SendQuota?.Max24HourSend ?? null,
      sentLast24Hours: account.SendQuota?.SentLast24Hours ?? null,
      enforcementStatus: account.EnforcementStatus ?? null,
      reviewStatus: account.Details?.ReviewDetails?.Status ?? null,
      reviewCaseId: account.Details?.ReviewDetails?.CaseId ?? null,
    };
  } finally {
    client.destroy();
  }
}

export interface SesSendInput {
  from: string;
  to: string[];
  subject: string;
  html?: string | undefined;
  text?: string | undefined;
}

export interface SesSendResult {
  messageId: string | null;
  requestId: string | null;
}

export async function sendViaSes(
  credentials: SesCredentials,
  input: SesSendInput,
): Promise<SesSendResult> {
  const client = createSesClient(credentials);

  try {
    const output: SendEmailCommandOutput = await client.send(
      new SendEmailCommand({
        FromEmailAddress: input.from,
        Destination: { ToAddresses: input.to },
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: "UTF-8" },
            Body: {
              ...(input.html
                ? { Html: { Data: input.html, Charset: "UTF-8" } }
                : {}),
              ...(input.text
                ? { Text: { Data: input.text, Charset: "UTF-8" } }
                : {}),
            },
          },
        },
      }),
    );

    return {
      messageId: output.MessageId ?? null,
      requestId: output.$metadata.requestId ?? null,
    };
  } finally {
    client.destroy();
  }
}

/**
 * SES domain identity state — SRS FR-2.
 *
 * `verificationStatus` is the authority on whether SES will accept mail from
 * the domain. For an Easy DKIM domain identity it follows `dkimStatus`: SES
 * verifies the domain by finding its DKIM CNAMEs.
 */
export interface SesDomainIdentity {
  /** PENDING | SUCCESS | FAILED | TEMPORARY_FAILURE | NOT_STARTED */
  verificationStatus: string | null;
  dkimStatus: string | null;
  dkimTokens: string[];
  verifiedForSending: boolean;
}

function toDomainIdentity(
  dkim: DkimAttributes | undefined,
  verifiedForSending: boolean | undefined,
  verificationStatus: string | undefined,
): SesDomainIdentity {
  return {
    verificationStatus: verificationStatus ?? null,
    dkimStatus: dkim?.Status ?? null,
    dkimTokens: dkim?.Tokens ?? [],
    verifiedForSending: verifiedForSending ?? false,
  };
}

/**
 * Creates a domain identity with Easy DKIM (SES generates the 2048-bit key and
 * issues three CNAME tokens). Throws `AlreadyExistsException` if the identity
 * already exists in this account and region; the caller adopts it instead.
 */
export async function createDomainIdentity(
  credentials: SesCredentials,
  domain: string,
): Promise<SesDomainIdentity> {
  const client = createSesClient(credentials);

  try {
    const output = await client.send(
      new CreateEmailIdentityCommand({ EmailIdentity: domain }),
    );
    return toDomainIdentity(
      output.DkimAttributes,
      output.VerifiedForSendingStatus,
      // CreateEmailIdentity does not report a verification status; a brand
      // new identity is by definition pending until its DNS is found.
      "PENDING",
    );
  } finally {
    client.destroy();
  }
}

/** Throws `NotFoundException` if the identity does not exist in SES. */
export async function getDomainIdentity(
  credentials: SesCredentials,
  domain: string,
): Promise<SesDomainIdentity> {
  const client = createSesClient(credentials);

  try {
    const output = await client.send(
      new GetEmailIdentityCommand({ EmailIdentity: domain }),
    );
    return toDomainIdentity(
      output.DkimAttributes,
      output.VerifiedForSendingStatus,
      output.VerificationStatus,
    );
  } finally {
    client.destroy();
  }
}
