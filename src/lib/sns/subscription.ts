import { isTrustedSnsUrl } from "./message";

/**
 * Confirms an SNS subscription by visiting its SubscribeURL.
 *
 * Only ever called on a message whose signature has verified and whose topic a
 * tenant has registered. The host check is repeated here regardless: this is a
 * server-side GET to a URL that arrived in a request body, and it must never be
 * steerable at an internal address.
 */
export class SubscriptionConfirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionConfirmError";
  }
}

export async function confirmSubscription(
  subscribeUrl: string,
): Promise<{ subscriptionArn: string | null }> {
  if (!isTrustedSnsUrl(subscribeUrl)) {
    throw new SubscriptionConfirmError("Untrusted SubscribeURL");
  }

  const response = await fetch(subscribeUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new SubscriptionConfirmError(
      `SNS returned HTTP ${response.status} to the confirmation request`,
    );
  }

  // ConfirmSubscriptionResponse is XML; only the ARN is needed.
  const body = (await response.text()).slice(0, 8_192);
  const match = /<SubscriptionArn>([^<]+)<\/SubscriptionArn>/.exec(body);

  return { subscriptionArn: match?.[1]?.trim() ?? null };
}
