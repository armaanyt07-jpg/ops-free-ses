/**
 * Core database schema.
 *
 * This is the SRS v1.0 §6 Drizzle baseline, reproduced as specified. The SRS is
 * the source of truth: column names, lengths, nullability and indexes are not
 * altered here.
 *
 * Phase 1 exercises `users`, `awsCredentials`, `apiKeys` and `emailLogs`. The
 * remaining tables are created by the same migration because `emailLogs` holds
 * a foreign key into `emailTemplates`.
 *
 * Phase 3 departs from the baseline in exactly these places, all additive:
 *
 *   - `verified_domains.aws_region` and `.check_result` (nullable) — see the
 *     comments on those columns;
 *   - `sns_events`, which SRS §6 lists under "Recommended additional
 *     production tables";
 *   - `sns_topics`, the registry that maps an SNS topic to the tenant who owns
 *     it, which SRS §7 step 2 ("Validate TopicArn") needs something to
 *     validate against.
 *
 * Phase 4 adds, equally additively:
 *
 *   - `aws_credentials.account_snapshot` (nullable) — the last `GetAccount`
 *     result, for the AWS screen's "quota snapshot, sandbox state" (SRS §12);
 *   - `email_logs_user_env_queued`, the index behind environment-scoped
 *     activity search and statistics;
 *   - `audit_logs` (SRS §6 recommended), which makes manual suppression
 *     changes "explicit and auditable" (SRS §11).
 *
 * Phase 5 adds `email_template_versions` (immutable history behind
 * `email_templates.version`) and `email_logs.template_version` (nullable), so
 * every templated send records exactly which version it was rendered from.
 *
 * No baseline column is renamed, retyped or dropped.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const environmentEnum = pgEnum("environment", ["staging", "production"]);

export const domainStatusEnum = pgEnum("domain_status", [
  "pending",
  "verified",
  "failed",
]);

export const emailStatusEnum = pgEnum("email_status", [
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  displayName: varchar("display_name", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const awsCredentials = pgTable(
  "aws_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    environment: environmentEnum("environment").notNull(),
    accessKeyId: varchar("access_key_id", { length: 128 }).notNull(),
    secretAccessKeyCiphertext: text("secret_access_key_ciphertext").notNull(),
    awsRegion: varchar("aws_region", { length: 32 }).notNull(),
    sesMaxSendRate: integer("ses_max_send_rate"),
    active: boolean("active").default(true).notNull(),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Phase 4 addition: the last GetAccount snapshot (sandbox state, quota),
    // so the AWS screen can show it without an AWS call per page view.
    accountSnapshot: jsonb("account_snapshot"),
  },
  (t) => [uniqueIndex("aws_credentials_user_env").on(t.userId, t.environment)],
);

export const verifiedDomains = pgTable(
  "verified_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 253 }).notNull(),
    environment: environmentEnum("environment").notNull(),
    status: domainStatusEnum("status").default("pending").notNull(),
    sesIdentityArn: text("ses_identity_arn"),
    dkimTokens: jsonb("dkim_tokens"),
    spfRecord: text("spf_record"),
    dmarcRecord: text("dmarc_record"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Phase 3 addition. An SES identity lives in one region, and a credential
    // can later be rotated to a different one. Without recording where the
    // identity was created, a check after such a rotation would silently query
    // the wrong region and report a verified domain as missing.
    awsRegion: varchar("aws_region", { length: 32 }),
    // Phase 3 addition. The last SPF/DKIM/DMARC/SES check, so the dashboard
    // shows persisted state instead of doing DNS and AWS calls on every render.
    checkResult: jsonb("check_result"),
  },
  (t) => [
    uniqueIndex("verified_domains_user_domain_env").on(
      t.userId,
      t.domain,
      t.environment,
    ),
  ],
);

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    subject: varchar("subject", { length: 998 }).notNull(),
    htmlBody: text("html_body").notNull(),
    textBody: text("text_body"),
    variables: jsonb("variables"),
    version: integer("version").default(1).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("email_templates_user_name").on(t.userId, t.name)],
);

export const emailLogs = pgTable(
  "email_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    environment: environmentEnum("environment").notNull(),
    status: emailStatusEnum("status").default("queued").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }),
    messageId: varchar("message_id", { length: 255 }),
    sesRequestId: varchar("ses_request_id", { length: 255 }),
    fromAddress: varchar("from_address", { length: 320 }).notNull(),
    recipients: jsonb("recipients").notNull(),
    subject: varchar("subject", { length: 998 }).notNull(),
    templateId: uuid("template_id").references(() => emailTemplates.id, {
      onDelete: "set null",
    }),
    // Phase 5: the template version rendered for this message. With
    // `templateId` it pins the exact content sent, even after later edits.
    templateVersion: integer("template_version"),
    tags: jsonb("tags"),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    providerEvent: jsonb("provider_event"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("email_logs_user_queued").on(t.userId, t.queuedAt),
    index("email_logs_message").on(t.messageId),
    // Phase 4: the activity explorer and statistics always filter by tenant
    // and environment and order by time.
    index("email_logs_user_env_queued").on(t.userId, t.environment, t.queuedAt),
    uniqueIndex("email_logs_user_idempotency").on(t.userId, t.idempotencyKey),
  ],
);

export const suppressionList = pgTable(
  "suppression_list",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    reason: varchar("reason", { length: 40 }).notNull(),
    sourceEventId: varchar("source_event_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    active: boolean("active").default(true).notNull(),
  },
  (t) => [uniqueIndex("suppression_user_email").on(t.userId, t.email)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
    keyHash: text("key_hash").notNull(),
    environment: environmentEnum("environment").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("api_keys_hash").on(t.keyHash),
    index("api_keys_user_env").on(t.userId, t.environment),
  ],
);

/**
 * Every saved version of a template — Phase 5, FR-6 "template versions".
 *
 * `email_templates` holds the current version (the SRS §6 baseline, with its
 * `version` counter); this table holds every version, immutably. Saving
 * appends a row; restoring an old version appends a new row with the old
 * content, so history is never rewritten.
 */
export const emailTemplateVersions = pgTable(
  "email_template_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => emailTemplates.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    subject: varchar("subject", { length: 998 }).notNull(),
    htmlBody: text("html_body").notNull(),
    textBody: text("text_body"),
    variables: jsonb("variables"),
    /** Who saved it: the signed-in user's email. */
    createdBy: varchar("created_by", { length: 320 }),
    /** Optional note, e.g. "Restored from v3". */
    note: varchar("note", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("email_template_versions_template_version").on(t.templateId, t.version),
  ],
);

/**
 * SNS topics a tenant has registered as event sources — Phase 3.
 *
 * Every tenant posts to the same webhook URL (SRS §7), so the topic ARN is what
 * identifies the tenant. A topic can belong to only one tenant: if two could
 * register it, a bounce could not be attributed and one tenant could suppress
 * the other's recipients.
 */
export const snsTopics = pgTable(
  "sns_topics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicArn: varchar("topic_arn", { length: 320 }).notNull(),
    /** pending | confirmed | unsubscribed */
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    subscriptionArn: varchar("subscription_arn", { length: 512 }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("sns_topics_topic_arn").on(t.topicArn),
    index("sns_topics_user").on(t.userId),
  ],
);

/**
 * Every SNS message accepted by the webhook — SRS §6 recommended table.
 *
 * The unique index on the SNS `MessageId` is the webhook idempotency guarantee
 * (SRS §7 step 3): a redelivered message conflicts on insert and changes
 * nothing. `payload` is a bounded, redacted projection, never the raw SES
 * notification, which carries message headers and subjects (SRS §11).
 */
export const snsEvents = pgTable(
  "sns_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: varchar("message_id", { length: 128 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicArn: varchar("topic_arn", { length: 320 }).notNull(),
    /** SNS envelope type: Notification, SubscriptionConfirmation, ... */
    messageType: varchar("message_type", { length: 40 }).notNull(),
    /** SES event: Bounce, Complaint, Delivery, ... Null for non-SES messages. */
    eventType: varchar("event_type", { length: 40 }),
    sesMessageId: varchar("ses_message_id", { length: 255 }),
    /** Null until the SES message id is matched to a log row. */
    logId: uuid("log_id").references(() => emailLogs.id, {
      onDelete: "set null",
    }),
    /** When SES says the event happened; `receivedAt - eventAt` is webhook lag. */
    eventAt: timestamp("event_at", { withTimezone: true }),
    payload: jsonb("payload"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("sns_events_message_id").on(t.messageId),
    index("sns_events_user_ses_message").on(t.userId, t.sesMessageId),
    index("sns_events_user_received").on(t.userId, t.receivedAt),
  ],
);

/**
 * Audit trail for deliberate human changes — SRS §6 recommended table, §11.
 *
 * Written in the same transaction as the change it records, so a change
 * without its audit row cannot exist. Automatic changes (a bounce suppressing
 * an address) are already traceable through `sns_events` and are not
 * duplicated here.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Who acted: the signed-in user's email at the time. */
    actor: varchar("actor", { length: 320 }).notNull(),
    /** e.g. suppression.add, suppression.remove, api_key.rotate */
    action: varchar("action", { length: 64 }).notNull(),
    /** What was acted on: an address, a key id, … */
    target: varchar("target", { length: 320 }).notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("audit_logs_user_created").on(t.userId, t.createdAt)],
);

export type Environment = (typeof environmentEnum.enumValues)[number];
export type EmailStatus = (typeof emailStatusEnum.enumValues)[number];
export type DomainStatus = (typeof domainStatusEnum.enumValues)[number];

export type User = typeof users.$inferSelect;
export type AwsCredential = typeof awsCredentials.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type EmailLog = typeof emailLogs.$inferSelect;
export type VerifiedDomain = typeof verifiedDomains.$inferSelect;
export type Suppression = typeof suppressionList.$inferSelect;
export type SnsTopic = typeof snsTopics.$inferSelect;
export type SnsEvent = typeof snsEvents.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type EmailTemplateVersion = typeof emailTemplateVersions.$inferSelect;
