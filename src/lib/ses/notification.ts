/**
 * SES event notifications — SRS FR-5 step 3, §11.
 *
 * SES reaches SNS by two routes that use different field names for the same
 * thing:
 *
 *   identity feedback notifications  →  `notificationType: "Bounce"`
 *   configuration-set event publishing →  `eventType: "Bounce"`
 *
 * Both are accepted and normalised to one shape, so the customer can use
 * whichever their account is set up for.
 *
 * `redactEvent` produces what is persisted. The raw notification carries the
 * message's headers, subject and sender (SRS §9: no unnecessary PII, no message
 * bodies); none of that is needed to update state, so none of it is kept.
 */
export type BounceType = "Permanent" | "Transient" | "Undetermined";

export interface BouncedRecipient {
  email: string;
  action: string | null;
  status: string | null;
  diagnostic: string | null;
}

export type SesEvent =
  | {
      kind: "bounce";
      sesMessageId: string;
      at: Date | null;
      bounceType: BounceType;
      bounceSubType: string | null;
      feedbackId: string | null;
      recipients: BouncedRecipient[];
    }
  | {
      kind: "complaint";
      sesMessageId: string;
      at: Date | null;
      feedbackType: string | null;
      feedbackId: string | null;
      recipients: string[];
    }
  | {
      kind: "delivery";
      sesMessageId: string;
      at: Date | null;
      recipients: string[];
      processingTimeMillis: number | null;
    }
  | {
      /** Anything else SES publishes (Send, Reject, DeliveryDelay, Open, ...). */
      kind: "other";
      type: string;
      sesMessageId: string | null;
      at: Date | null;
    };

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function str(value: unknown, max = 512): string | null {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Lowercased bare address; SES reports addresses without display names. */
export function normaliseAddress(value: string): string {
  return value.trim().toLowerCase();
}

function addresses(list: unknown, field = "emailAddress"): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const raw = typeof entry === "string" ? entry : obj(entry)?.[field];
    return typeof raw === "string" && raw.includes("@")
      ? [normaliseAddress(raw)]
      : [];
  });
}

/**
 * Parses an SNS `Message` body. Returns null if it is not an SES event at all —
 * for example SNS's own test messages, or a non-JSON string.
 */
export function parseSesNotification(message: string): SesEvent | null {
  let root: Json | null;
  try {
    root = obj(JSON.parse(message));
  } catch {
    return null;
  }
  if (!root) return null;

  const type = str(root.eventType ?? root.notificationType, 64);
  if (!type) return null;

  const mail = obj(root.mail);
  const sesMessageId = str(mail?.messageId, 255);
  const mailAt = date(mail?.timestamp);

  if (type === "Bounce" && sesMessageId) {
    const bounce = obj(root.bounce);
    const rawType = str(bounce?.bounceType, 32);
    const bounceType: BounceType =
      rawType === "Permanent" || rawType === "Transient"
        ? rawType
        : "Undetermined";

    const recipients = Array.isArray(bounce?.bouncedRecipients)
      ? bounce.bouncedRecipients.flatMap((entry): BouncedRecipient[] => {
          const r = obj(entry);
          const email = str(r?.emailAddress, 320);
          if (!email || !email.includes("@")) return [];
          return [
            {
              email: normaliseAddress(email),
              action: str(r?.action, 32),
              status: str(r?.status, 32),
              diagnostic: str(r?.diagnosticCode, 500),
            },
          ];
        })
      : [];

    return {
      kind: "bounce",
      sesMessageId,
      at: date(bounce?.timestamp) ?? mailAt,
      bounceType,
      bounceSubType: str(bounce?.bounceSubType, 64),
      feedbackId: str(bounce?.feedbackId, 255),
      recipients,
    };
  }

  if (type === "Complaint" && sesMessageId) {
    const complaint = obj(root.complaint);
    return {
      kind: "complaint",
      sesMessageId,
      at: date(complaint?.timestamp) ?? mailAt,
      feedbackType: str(complaint?.complaintFeedbackType, 64),
      feedbackId: str(complaint?.feedbackId, 255),
      recipients: addresses(complaint?.complainedRecipients),
    };
  }

  if (type === "Delivery" && sesMessageId) {
    const delivery = obj(root.delivery);
    const ms = delivery?.processingTimeMillis;
    return {
      kind: "delivery",
      sesMessageId,
      at: date(delivery?.timestamp) ?? mailAt,
      recipients: addresses(delivery?.recipients),
      processingTimeMillis: typeof ms === "number" ? ms : null,
    };
  }

  return { kind: "other", type, sesMessageId, at: mailAt };
}

/** SRS §11: "a bounded/redacted event representation". */
export function redactEvent(event: SesEvent): Json {
  switch (event.kind) {
    case "bounce":
      return {
        bounceType: event.bounceType,
        bounceSubType: event.bounceSubType,
        feedbackId: event.feedbackId,
        recipients: event.recipients.slice(0, 50),
      };
    case "complaint":
      return {
        feedbackType: event.feedbackType,
        feedbackId: event.feedbackId,
        recipients: event.recipients.slice(0, 50),
      };
    case "delivery":
      return {
        recipients: event.recipients.slice(0, 50),
        processingTimeMillis: event.processingTimeMillis,
      };
    case "other":
      return { type: event.type };
  }
}

export function eventTypeName(event: SesEvent): string {
  switch (event.kind) {
    case "bounce":
      return "Bounce";
    case "complaint":
      return "Complaint";
    case "delivery":
      return "Delivery";
    case "other":
      return event.type;
  }
}

/**
 * Rebuilds an event from its persisted form (`sns_events` columns plus the
 * redacted payload). Used to apply an event that arrived before its log row
 * could be matched. `redactEvent` keeps exactly the fields state changes need,
 * so nothing required is lost in the round trip.
 */
export function restoreEvent(stored: {
  eventType: string | null;
  sesMessageId: string | null;
  eventAt: Date | null;
  payload: unknown;
}): SesEvent | null {
  const { eventType, sesMessageId, eventAt: at } = stored;
  const payload = obj(stored.payload) ?? {};
  if (!eventType || !sesMessageId) return null;

  if (eventType === "Bounce") {
    const rawType = payload.bounceType;
    return {
      kind: "bounce",
      sesMessageId,
      at,
      bounceType:
        rawType === "Permanent" || rawType === "Transient"
          ? rawType
          : "Undetermined",
      bounceSubType: str(payload.bounceSubType, 64),
      feedbackId: str(payload.feedbackId, 255),
      recipients: Array.isArray(payload.recipients)
        ? (payload.recipients as BouncedRecipient[])
        : [],
    };
  }

  if (eventType === "Complaint") {
    return {
      kind: "complaint",
      sesMessageId,
      at,
      feedbackType: str(payload.feedbackType, 64),
      feedbackId: str(payload.feedbackId, 255),
      recipients: addresses(payload.recipients),
    };
  }

  if (eventType === "Delivery") {
    const ms = payload.processingTimeMillis;
    return {
      kind: "delivery",
      sesMessageId,
      at,
      recipients: addresses(payload.recipients),
      processingTimeMillis: typeof ms === "number" ? ms : null,
    };
  }

  return null;
}
