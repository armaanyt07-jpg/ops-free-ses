import type { EmailStatus } from "@/db/schema";

import { normaliseAddress, type SesEvent } from "./notification";

/**
 * How SES events change an email log — SRS FR-5 step 5, Appendix A step 12.
 *
 * Two facts shape this:
 *
 *   1. **One log row can cover up to 50 recipients**, but SES reports outcomes
 *      per recipient. Each recipient's outcome is recorded individually in
 *      `providerEvent.recipients`; the row's `status` is the most severe
 *      outcome across them, so a single complaint is never hidden behind 49
 *      deliveries.
 *
 *   2. **SNS does not guarantee order.** A delivery can arrive after a
 *      complaint about the same message. Outcomes therefore only move forward
 *      by severity — delivered < bounced < complained — and a later, milder
 *      event never overwrites a worse one.
 *
 * Pure: the caller loads the row under a lock and writes back the result.
 */
export type RecipientOutcome = "delivered" | "bounced" | "complained";

export interface RecipientState {
  status: RecipientOutcome;
  at: string | null;
  snsMessageId: string;
  bounceType?: string | undefined;
  bounceSubType?: string | null | undefined;
  diagnostic?: string | null | undefined;
  feedbackType?: string | null | undefined;
}

const RANK: Record<string, number> = {
  sent: 0,
  delivered: 1,
  bounced: 2,
  complained: 3,
};

export interface LogSnapshot {
  status: EmailStatus;
  recipients: string[];
  providerEvent: unknown;
}

export interface LogUpdate {
  status: EmailStatus;
  providerEvent: Record<string, unknown>;
  /** True once every recipient on the log has a final outcome. */
  complete: boolean;
}

function existingRecipients(
  providerEvent: unknown,
): Record<string, RecipientState> {
  if (typeof providerEvent !== "object" || providerEvent === null) return {};
  const recipients = (providerEvent as { recipients?: unknown }).recipients;
  return typeof recipients === "object" && recipients !== null
    ? { ...(recipients as Record<string, RecipientState>) }
    : {};
}

function outcomesFor(
  event: SesEvent,
  snsMessageId: string,
): Array<[string, RecipientState]> {
  const at = event.at?.toISOString() ?? null;

  switch (event.kind) {
    case "delivery":
      return event.recipients.map((email) => [
        email,
        { status: "delivered", at, snsMessageId },
      ]);
    case "bounce":
      return event.recipients.map((r) => [
        r.email,
        {
          status: "bounced",
          at,
          snsMessageId,
          bounceType: event.bounceType,
          bounceSubType: event.bounceSubType,
          diagnostic: r.diagnostic,
        },
      ]);
    case "complaint":
      return event.recipients.map((email) => [
        email,
        {
          status: "complained",
          at,
          snsMessageId,
          feedbackType: event.feedbackType,
        },
      ]);
    case "other":
      return [];
  }
}

/** Returns the new row state, or null if the event changes nothing. */
export function applyEventToLog(
  log: LogSnapshot,
  event: SesEvent,
  snsMessageId: string,
): LogUpdate | null {
  const onLog = new Set(log.recipients.map(normaliseAddress));
  const recipients = existingRecipients(log.providerEvent);
  let changed = false;

  for (const [email, next] of outcomesFor(event, snsMessageId)) {
    // An address SES reports that this log never sent to is not this log's
    // state to record. (It can still be suppressed — that is per tenant.)
    if (!onLog.has(email)) continue;

    const current = recipients[email];
    if (current && RANK[current.status]! >= RANK[next.status]!) continue;

    recipients[email] = next;
    changed = true;
  }

  if (!changed) return null;

  // Severity only ratchets upward from the row's current delivery-family
  // status. Anything else (`sending`, or `failed` after a lost markSent) is
  // superseded, because an SES event is proof that SES accepted the message.
  let rank = RANK[log.status] ?? 0;
  for (const state of Object.values(recipients)) {
    rank = Math.max(rank, RANK[state.status]!);
  }
  const status = (Object.keys(RANK).find((k) => RANK[k] === rank) ??
    "sent") as EmailStatus;

  const previous =
    typeof log.providerEvent === "object" && log.providerEvent !== null
      ? (log.providerEvent as Record<string, unknown>)
      : {};

  return {
    status,
    providerEvent: { ...previous, recipients },
    complete: [...onLog].every((email) => recipients[email] !== undefined),
  };
}
