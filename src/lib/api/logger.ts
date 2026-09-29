/**
 * Structured logging — SRS §14.
 *
 * Every line carries the correlation id, tenant and environment where known.
 * SRS §9 forbids logging credentials, bearer tokens, full message bodies and
 * unnecessary PII, so this module takes a fixed, allow-listed field set: there
 * is no `...rest` spread through which a secret could arrive by accident.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  event: string;
  requestId: string;
  userId?: string | undefined;
  environment?: string | undefined;
  logId?: string | undefined;
  /** BullMQ job id, so a message can be followed across worker attempts. */
  jobId?: string | undefined;
  attempt?: number | undefined;
  apiKeyId?: string | undefined;
  status?: string | undefined;
  errorCode?: string | undefined;
  /** Short, non-sensitive detail. Never a message body or credential. */
  detail?: string | undefined;
  durationMs?: number | undefined;
  recipientCount?: number | undefined;
}

function emit(level: LogLevel, fields: LogFields): void {
  const line = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    ...Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    ),
  });

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Security-relevant changes made through the dashboard (Phase 7): who changed
 * what. Never the secret itself — the typed fields leave nowhere to put one.
 */
function security(event: string, userId: string, detail?: string): void {
  emit("info", { event: `security.${event}`, requestId: "dashboard", userId, detail });
}

export const log = {
  security,
  debug: (fields: LogFields) => emit("debug", fields),
  info: (fields: LogFields) => emit("info", fields),
  warn: (fields: LogFields) => emit("warn", fields),
  error: (fields: LogFields) => emit("error", fields),
};
