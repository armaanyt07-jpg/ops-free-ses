import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { emailIdentities, snsTopics, verifiedDomains, type Environment, type SnsTopic } from "@/db/schema";
import {
  attachConfigurationSet,
  ensureConfigurationSet,
  ensureEventsTopic,
  subscribeWebhook,
} from "@/lib/aws/events";
import { log } from "@/lib/api/logger";
import { loadSesCredentials } from "@/server/credentials";
import { registerTopic, TopicRegistrationError } from "@/server/sns-topics";

/**
 * "Connect events" — Phase 8. Replaces the four manual AWS steps on the
 * Webhooks page with one action, using the environment's stored credential.
 * AWS calls live in `src/lib/aws/events.ts`; this is the ordering and the
 * bookkeeping.
 *
 * Order matters: the topic is registered *before* subscribing, because the
 * webhook refuses to confirm a subscription for an unregistered topic.
 */
export class EventsSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventsSetupError";
  }
}

export interface EventsSetupResult {
  topicArn: string;
  /** Domains and addresses whose SES identity now publishes events through the set. */
  domains: string[];
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "UnknownError";
}

const DENIED = new Set(["AccessDenied", "AccessDeniedException", "AuthorizationError", "AuthorizationErrorException"]);

async function step<T>(permission: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (DENIED.has(errorName(error))) {
      throw new EventsSetupError(
        `Your IAM user is not allowed to call ${permission}. Replace its policy with the one on the AWS page, then try again.`,
      );
    }
    throw new EventsSetupError(`AWS refused ${permission} (${errorName(error)}). Try again, or set it up manually below.`);
  }
}

export async function connectEvents(
  userId: string,
  environment: Environment,
  endpoint: string,
): Promise<EventsSetupResult> {
  if (!endpoint.startsWith("https://")) {
    throw new EventsSetupError(
      "SNS can only deliver to a public HTTPS address. This works once the app is deployed (or PUBLIC_APP_URL points at a tunnel).",
    );
  }

  const credentials = await loadSesCredentials(userId, environment);
  if (!credentials) {
    throw new EventsSetupError(`Connect your AWS account for ${environment} first.`);
  }

  const topicArn = await step("sns:CreateTopic", () => ensureEventsTopic(credentials));

  let topic: SnsTopic;
  try {
    topic = await registerTopic(userId, topicArn);
  } catch (error) {
    if (error instanceof TopicRegistrationError) throw new EventsSetupError(error.message);
    throw error;
  }
  await getDb()
    .update(snsTopics)
    .set({ managed: true, environment })
    .where(and(eq(snsTopics.id, topic.id), eq(snsTopics.userId, userId)));

  await step("sns:Subscribe", () => subscribeWebhook(credentials, topicArn, endpoint));
  await step("ses:CreateConfigurationSet", () => ensureConfigurationSet(credentials, topicArn));

  const rows = await getDb()
    .select({ domain: verifiedDomains.domain })
    .from(verifiedDomains)
    .where(and(eq(verifiedDomains.userId, userId), eq(verifiedDomains.environment, environment)));

  const addresses = await getDb()
    .select({ domain: emailIdentities.email })
    .from(emailIdentities)
    .where(and(eq(emailIdentities.userId, userId), eq(emailIdentities.environment, environment)));

  const domains: string[] = [];
  for (const { domain } of [...rows, ...addresses]) {
    try {
      await attachConfigurationSet(credentials, domain);
      domains.push(domain);
    } catch (error) {
      // An identity deleted in the SES console is not ours to recreate.
      if (errorName(error) === "NotFoundException") continue;
      await step("ses:PutEmailIdentityConfigurationSetAttributes", () => Promise.reject(error));
    }
  }

  return { topicArn, domains };
}

/**
 * Runs "Connect events" as part of connecting AWS, so it isn't a separate
 * setup step. Best effort: the AWS connection stands either way, and if this
 * fails the dashboard keeps the Connect events button, which shows AWS's
 * reason when pressed. Skips when events are already connected, or when SNS
 * couldn't reach this app (local development without a tunnel).
 */
export async function connectEventsAfterConnect(
  userId: string,
  environment: Environment,
  endpoint: { url: string; local: boolean },
): Promise<boolean> {
  if (await hasManagedEvents(userId, environment)) return true;
  if (endpoint.local) return false;
  try {
    const result = await connectEvents(userId, environment, endpoint.url);
    log.security("sns_topic.connected", userId, `${result.topicArn} (with AWS connect)`);
    return true;
  } catch (error) {
    log.warn({
      event: "sns_topic.auto_connect_failed",
      requestId: "aws-connect",
      userId,
      environment,
      detail: error instanceof EventsSetupError ? error.message : error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

/** True once "Connect events" has run for this environment. */
export async function hasManagedEvents(
  userId: string,
  environment: Environment,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: snsTopics.id })
    .from(snsTopics)
    .where(
      and(
        eq(snsTopics.userId, userId),
        eq(snsTopics.managed, true),
        eq(snsTopics.environment, environment),
      ),
    )
    .limit(1);
  return Boolean(row);
}
