import "server-only";

import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  PutEmailIdentityConfigurationSetAttributesCommand,
  UpdateConfigurationSetEventDestinationCommand,
  type EventDestinationDefinition,
} from "@aws-sdk/client-sesv2";
import { CreateTopicCommand, SNSClient, SubscribeCommand } from "@aws-sdk/client-sns";

import { createSesClient, type SesCredentials } from "@/lib/ses/client";

/**
 * "Connect events" (Phase 8): the AWS side of what the Webhooks page used to
 * ask the customer to do by hand, performed with their stored credential.
 *
 *   1. a standard SNS topic                         (CreateTopic)
 *   2. an HTTPS subscription to our webhook          (Subscribe)
 *   3. an SES configuration set publishing Bounce,   (CreateConfigurationSet +
 *      Complaint and Delivery to that topic           …EventDestination)
 *   4. that set as each domain's default, so every   (PutEmailIdentity…)
 *      send uses it without the send path naming it
 *
 * Every step is idempotent, so the button can be pressed again to repair a
 * half-finished setup or to pick up newly added domains. The webhook already
 * parses the configuration-set event format (`eventType`), see
 * `src/lib/ses/notification.ts`.
 */
export const EVENTS_TOPIC_NAME = "ops-free-ses-events";
export const CONFIGURATION_SET_NAME = "ops-free";
export const EVENT_DESTINATION_NAME = "ops-free-sns";

function createSnsClient(credentials: SesCredentials): SNSClient {
  return new SNSClient({
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    maxAttempts: 3,
  });
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "UnknownError";
}

/** CreateTopic returns the existing topic's ARN when the name is taken. */
export async function ensureEventsTopic(credentials: SesCredentials): Promise<string> {
  const client = createSnsClient(credentials);
  try {
    const out = await client.send(new CreateTopicCommand({ Name: EVENTS_TOPIC_NAME }));
    if (!out.TopicArn) throw new Error("SNS CreateTopic returned no TopicArn");
    return out.TopicArn;
  } finally {
    client.destroy();
  }
}

/**
 * Subscribing the same endpoint twice returns the existing subscription. Raw
 * message delivery stays off (the default): the signature lives in the
 * envelope it would strip. SNS then posts a SubscriptionConfirmation, which
 * the webhook confirms because the topic is registered first.
 */
export async function subscribeWebhook(
  credentials: SesCredentials,
  topicArn: string,
  endpoint: string,
): Promise<void> {
  const client = createSnsClient(credentials);
  try {
    await client.send(
      new SubscribeCommand({ TopicArn: topicArn, Protocol: "https", Endpoint: endpoint }),
    );
  } finally {
    client.destroy();
  }
}

export async function ensureConfigurationSet(
  credentials: SesCredentials,
  topicArn: string,
): Promise<void> {
  const client = createSesClient(credentials);
  const destination: EventDestinationDefinition = {
    Enabled: true,
    MatchingEventTypes: ["BOUNCE", "COMPLAINT", "DELIVERY"],
    SnsDestination: { TopicArn: topicArn },
  };

  try {
    try {
      await client.send(
        new CreateConfigurationSetCommand({ ConfigurationSetName: CONFIGURATION_SET_NAME }),
      );
    } catch (error) {
      if (errorName(error) !== "AlreadyExistsException") throw error;
    }

    try {
      await client.send(
        new CreateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: CONFIGURATION_SET_NAME,
          EventDestinationName: EVENT_DESTINATION_NAME,
          EventDestination: destination,
        }),
      );
    } catch (error) {
      if (errorName(error) !== "AlreadyExistsException") throw error;
      // Point an existing destination at the current topic.
      await client.send(
        new UpdateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: CONFIGURATION_SET_NAME,
          EventDestinationName: EVENT_DESTINATION_NAME,
          EventDestination: destination,
        }),
      );
    }
  } finally {
    client.destroy();
  }
}

/** Makes the configuration set the identity's default for every send. */
export async function attachConfigurationSet(
  credentials: SesCredentials,
  identity: string,
): Promise<void> {
  const client = createSesClient(credentials);
  try {
    await client.send(
      new PutEmailIdentityConfigurationSetAttributesCommand({
        EmailIdentity: identity,
        ConfigurationSetName: CONFIGURATION_SET_NAME,
      }),
    );
  } finally {
    client.destroy();
  }
}
