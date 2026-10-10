import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { hostingPlatform, normaliseDomain } from "@/lib/dns/checks";
import { MAX_DKIM_TOKENS, parseDkimInput } from "@/lib/dns/dkim-input";
import { checkDns } from "@/lib/dns/run";
import { checkLimit, clientIp } from "@/server/abuse";

/**
 * POST /api/tools/dns-check — the public SES DNS checker at /tools/ses-dns-checker.
 *
 * No account needed, so it is limited per IP before any lookup runs, and it
 * only reads public DNS: nothing is stored and nothing touches AWS.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  domain: z.string().max(300),
  dkim: z.string().max(1000).optional().default(""),
});

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = await checkLimit("dnsTool", clientIp(request.headers));
  if (!limit.allowed) {
    const seconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    return json(
      { error: `Too many checks from your network. Try again in ${seconds} seconds.` },
      429,
      { "Retry-After": String(seconds) },
    );
  }

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Send a domain to check." }, 400);

  const platform = hostingPlatform(parsed.data.domain);
  if (platform) {
    return json(
      {
        error: `That's a free ${platform} subdomain. Its DNS belongs to ${platform}, so you can't add the records SES needs. Use a domain you own.`,
      },
      400,
    );
  }

  const domain = normaliseDomain(parsed.data.domain);
  if (!domain) {
    return json({ error: "That doesn't look like a domain. Type just the domain, like example.com." }, 400);
  }

  const { tokens, invalid } = parseDkimInput(parsed.data.dkim);
  if (invalid.length > 0) {
    return json({ error: `These don't look like SES DKIM tokens: ${invalid.slice(0, 3).join(", ")}` }, 400);
  }
  if (tokens.length > MAX_DKIM_TOKENS) {
    return json({ error: `SES gives each domain ${MAX_DKIM_TOKENS} DKIM tokens. Paste at most ${MAX_DKIM_TOKENS}.` }, 400);
  }

  const result = await checkDns(domain, tokens);
  return json({ domain, dkimChecked: tokens.length > 0, ...result });
}
