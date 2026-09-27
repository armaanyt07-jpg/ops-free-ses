"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  registerTopic,
  removeTopic,
  TopicRegistrationError,
} from "@/server/sns-topics";
import { requireTenant } from "@/server/tenant";

export interface TopicFormState {
  error?: string;
  success?: string;
}

export async function addTopic(
  _prev: TopicFormState,
  formData: FormData,
): Promise<TopicFormState> {
  const tenant = await requireTenant();

  const arn = z.string().trim().min(1).max(320).safeParse(formData.get("topicArn"));
  if (!arn.success) return { error: "Enter the topic ARN." };

  try {
    const topic = await registerTopic(tenant.id, arn.data);
    revalidatePath("/dashboard/webhooks");
    return {
      success:
        topic.status === "confirmed"
          ? "This topic is already registered and confirmed."
          : "Topic registered. Now subscribe the endpoint to it in SNS — the subscription is confirmed automatically.",
    };
  } catch (error) {
    if (error instanceof TopicRegistrationError) return { error: error.message };
    return { error: "The topic could not be registered." };
  }
}

export async function deleteTopic(formData: FormData): Promise<void> {
  const tenant = await requireTenant();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  await removeTopic(tenant.id, id.data);
  revalidatePath("/dashboard/webhooks");
}
