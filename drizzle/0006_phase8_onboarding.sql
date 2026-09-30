ALTER TABLE "sns_topics" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sns_topics" ADD COLUMN "environment" "environment";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "staging_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Accounts that already set anything up in staging keep seeing it.
UPDATE "users" SET "staging_enabled" = true
WHERE "id" IN (
  SELECT "user_id" FROM "aws_credentials" WHERE "environment" = 'staging'
  UNION SELECT "user_id" FROM "api_keys" WHERE "environment" = 'staging'
  UNION SELECT "user_id" FROM "verified_domains" WHERE "environment" = 'staging'
);
