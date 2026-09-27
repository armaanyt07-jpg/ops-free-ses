import { z } from "zod";

/**
 * Request contract for POST /api/v1/send — SRS §7.
 *
 * Column widths from the SRS §6 schema are mirrored as validation bounds, so a
 * request that could not be persisted is rejected at the edge with a readable
 * message rather than failing later as a database error.
 *
 * Two content modes (Phase 5):
 *
 *   template  `templateId` (+ `variables`). The stored template supplies the
 *             subject, HTML and text; sending inline content as well is
 *             refused, because "which subject wins?" has no good silent answer.
 *   inline    `subject` + `html` and/or `text`, optionally with `variables`,
 *             which interpolate `{{name}}` in that content — the SRS §7
 *             example. Without `variables`, inline content is sent literally,
 *             exactly as before Phase 5.
 */
const MAX_RECIPIENTS = 50; // SES SendEmail destination limit.

const emailAddress = z
  .string()
  .trim()
  .min(3)
  .max(320) // matches varchar(320) on from_address
  .email("Must be a valid email address");

export const sendRequestSchema = z
  .object({
    from: emailAddress,
    to: z
      .array(emailAddress)
      .min(1, "At least one recipient is required")
      .max(MAX_RECIPIENTS, `At most ${MAX_RECIPIENTS} recipients per request`),
    subject: z
      .string()
      .min(1, "Subject is required")
      .max(998, "Subject exceeds the maximum header length")
      .optional(),
    html: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    templateId: z.string().uuid().optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const inline = ["subject", "html", "text"].filter(
      (k) => value[k as "subject" | "html" | "text"] !== undefined,
    );

    if (value.templateId !== undefined) {
      if (inline.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: [inline[0]!],
          message: `\`templateId\` and inline content are mutually exclusive — the template supplies the subject, html and text. Remove: ${inline.join(", ")}.`,
        });
      }
      return;
    }

    if (value.subject === undefined) {
      ctx.addIssue({ code: "custom", path: ["subject"], message: "Subject is required (or send a `templateId`)" });
    }
    if (value.html === undefined && value.text === undefined) {
      ctx.addIssue({ code: "custom", path: ["html"], message: "Provide at least one of `html` or `text`" });
    }
  });

export type SendRequest = z.infer<typeof sendRequestSchema>;

/** Case-insensitive de-duplication, preserving the caller's ordering. */
export function normaliseRecipients(to: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const address of to) {
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(address);
  }

  return result;
}

export const IDEMPOTENCY_KEY_MAX_LENGTH = 255; // varchar(255) in email_logs

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(IDEMPOTENCY_KEY_MAX_LENGTH);
