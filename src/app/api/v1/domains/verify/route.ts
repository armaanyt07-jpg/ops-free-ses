import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { environmentEnum } from "@/db/schema";
import { ERROR_CODES, errorEnvelope, statusForCode } from "@/lib/api/errors";
import { log } from "@/lib/api/logger";
import { resolveRequestId } from "@/lib/api/request-id";
import { parseBearerToken } from "@/lib/crypto/api-key";
import { authenticateApiKey } from "@/server/api-keys";
import { checkDomainIfStale, findDomain } from "@/server/domains";

/**
 * GET /api/v1/domains/verify?domain=example.com&environment=production
 * — SRS §7.
 *
 * Authenticated with an API key, like the send API. A key is scoped to one
 * environment and can only see that environment's domains.
 *
 * Re-checks SES and DNS when the stored result is older than the cooldown and
 * returns the stored result otherwise, so polling this endpoint in a loop
 * costs at most one AWS call per domain per cooldown window.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  domain: z.string().trim().min(1).max(253),
  environment: z.enum(environmentEnum.enumValues).optional(),
});

function failure(
  code: keyof typeof ERROR_CODES,
  message: string,
  requestId: string,
): NextResponse {
  return NextResponse.json(errorEnvelope(ERROR_CODES[code], message, requestId), {
    status: statusForCode(ERROR_CODES[code]),
    headers: { "X-Request-Id": requestId },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  const presented = parseBearerToken(request.headers.get("authorization"));
  const auth = presented ? await authenticateApiKey(presented) : null;
  if (!auth?.ok) {
    return failure(
      "UNAUTHORIZED",
      "A valid API key must be supplied as `Authorization: Bearer <key>`.",
      requestId,
    );
  }

  const { userId, environment: keyEnvironment } = auth.key;

  const query = querySchema.safeParse({
    domain: request.nextUrl.searchParams.get("domain") ?? undefined,
    environment: request.nextUrl.searchParams.get("environment") ?? undefined,
  });
  if (!query.success) {
    return failure(
      "INVALID_REQUEST",
      "`domain` is required; `environment` must be staging or production.",
      requestId,
    );
  }

  const environment = query.data.environment ?? keyEnvironment;
  if (environment !== keyEnvironment) {
    return failure(
      "INVALID_REQUEST",
      `This API key is scoped to ${keyEnvironment} and cannot read ${environment} domains.`,
      requestId,
    );
  }

  const domain = await findDomain(userId, query.data.domain, environment);
  if (!domain) {
    return failure(
      "DOMAIN_NOT_VERIFIED",
      `No domain ${query.data.domain} has been added for ${environment}. Add it in the dashboard first.`,
      requestId,
    );
  }

  const checked = await checkDomainIfStale(userId, domain.id);
  const view = checked?.view ?? domain;
  const check = view.check;

  log.info({
    event: "domains.verify",
    requestId,
    userId,
    environment,
    status: view.status,
    detail: checked?.fresh ? "fresh" : "cached",
  });

  return NextResponse.json(
    {
      domain: view.domain,
      environment: view.environment,
      region: view.region,
      status: view.status,
      checks: check
        ? {
            sesIdentity: check.sesIdentity.status,
            spf: {
              status: check.spf.status,
              found: check.spf.found,
              problems: check.spf.problems,
            },
            dkim: {
              status: check.dkim.status,
              records: check.dkim.records,
              problems: check.dkim.problems,
            },
            dmarc: {
              status: check.dmarc.status,
              policy: check.dmarc.policy,
              found: check.dmarc.found,
              problems: check.dmarc.problems,
            },
          }
        : null,
      records: view.records,
      checkedAt: view.lastCheckedAt?.toISOString() ?? null,
    },
    { status: 200, headers: { "X-Request-Id": requestId } },
  );
}
