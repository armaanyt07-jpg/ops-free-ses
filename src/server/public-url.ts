import "server-only";

import { headers } from "next/headers";

export const WEBHOOK_PATH = "/api/v1/webhooks/aws-sns";

const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/;

/**
 * This app's public origin, e.g. `https://ops-free-ses.vercel.app`.
 * `PUBLIC_APP_URL` wins when set (a deployment, or a tunnel during
 * development); otherwise it is derived from the request, as the browser sees
 * this app. Pin it in production: a Vercel deployment-specific host serves
 * one old build behind Vercel's login, so nothing outside can use it.
 * `local` means the outside world could not reach it.
 */
export async function appOrigin(): Promise<{ origin: string; local: boolean }> {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    const host = configured.replace(/^https?:\/\//, "");
    return { origin: configured, local: LOCAL_HOST.test(host) };
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = LOCAL_HOST.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return { origin: `${proto}://${host}`, local };
}

/** The SNS webhook URL. `local` means SNS could not reach it. */
export async function webhookEndpoint(): Promise<{ url: string; local: boolean }> {
  const { origin, local } = await appOrigin();
  return { url: `${origin}${WEBHOOK_PATH}`, local };
}
