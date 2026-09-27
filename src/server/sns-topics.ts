import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { snsTopics, type SnsTopic } from "@/db/schema";
import { TOPIC_ARN } from "@/lib/sns/message";

/**
 * SNS topic registry — the "expected topic" of SRS FR-5 step 2.
 *
 * The webhook will not act on — or confirm a subscription for — any topic that
 * is not registered here. That is what stops a third party from subscribing
 * our endpoint to a topic they own and publishing signed, but fabricated,
 * bounces into it: the signature proves a message came from SNS, not that it
 * came from *this tenant's* SES.
 */
export class TopicRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicRegistrationError";
  }
}

export async function registerTopic(
  userId: string,
  rawArn: string,
): Promise<SnsTopic> {
  const topicArn = rawArn.trim();

  if (topicArn.endsWith(".fifo")) {
    throw new TopicRegistrationError(
      "SES cannot publish to FIFO topics. Create a standard SNS topic.",
    );
  }
  if (!TOPIC_ARN.test(topicArn)) {
    throw new TopicRegistrationError(
      "That is not an SNS topic ARN. It should look like arn:aws:sns:us-east-1:123456789012:ses-events.",
    );
  }

  const db = getDb();
  const [row] = await db
    .insert(snsTopics)
    .values({ userId, topicArn })
    .onConflictDoNothing({ target: snsTopics.topicArn })
    .returning();

  if (row) return row;

  const [existing] = await db
    .select()
    .from(snsTopics)
    .where(eq(snsTopics.topicArn, topicArn))
    .limit(1);

  // Re-registering your own topic is a no-op. Someone else's is refused,
  // without saying whose it is.
  if (existing && existing.userId === userId) return existing;
  throw new TopicRegistrationError(
    "This topic is already registered to another account.",
  );
}

export async function listTopics(userId: string): Promise<SnsTopic[]> {
  return getDb()
    .select()
    .from(snsTopics)
    .where(eq(snsTopics.userId, userId))
    .orderBy(asc(snsTopics.createdAt));
}

export async function removeTopic(
  userId: string,
  topicId: string,
): Promise<boolean> {
  const rows = await getDb()
    .delete(snsTopics)
    .where(and(eq(snsTopics.id, topicId), eq(snsTopics.userId, userId)))
    .returning({ id: snsTopics.id });
  return rows.length > 0;
}

/** Webhook lookup. Deliberately not tenant-scoped: the ARN is the tenant. */
export async function findTopicByArn(
  topicArn: string,
): Promise<SnsTopic | null> {
  const [row] = await getDb()
    .select()
    .from(snsTopics)
    .where(eq(snsTopics.topicArn, topicArn))
    .limit(1);
  return row ?? null;
}
