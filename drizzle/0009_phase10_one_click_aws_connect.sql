CREATE TYPE "public"."aws_connection_status" AS ENUM('pending', 'connected', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('access_key', 'role');--> statement-breakpoint
CREATE TABLE "aws_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"aws_region" varchar(32) NOT NULL,
	"status" "aws_connection_status" DEFAULT 'pending' NOT NULL,
	"role_arn" varchar(2048),
	"error" text,
	"callback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aws_credentials" ALTER COLUMN "access_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "aws_credentials" ALTER COLUMN "secret_access_key_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "aws_credentials" ADD COLUMN "kind" "credential_kind" DEFAULT 'access_key' NOT NULL;--> statement-breakpoint
ALTER TABLE "aws_credentials" ADD COLUMN "role_arn" varchar(2048);--> statement-breakpoint
ALTER TABLE "aws_credentials" ADD COLUMN "external_id" varchar(128);--> statement-breakpoint
ALTER TABLE "aws_connections" ADD CONSTRAINT "aws_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aws_connections_external_id" ON "aws_connections" USING btree ("external_id");--> statement-breakpoint
ALTER TABLE "aws_credentials" ADD CONSTRAINT "aws_credentials_kind_shape" CHECK (("aws_credentials"."kind" = 'access_key' AND "aws_credentials"."access_key_id" IS NOT NULL AND "aws_credentials"."secret_access_key_ciphertext" IS NOT NULL AND "aws_credentials"."role_arn" IS NULL)
        OR ("aws_credentials"."kind" = 'role' AND "aws_credentials"."role_arn" IS NOT NULL AND "aws_credentials"."external_id" IS NOT NULL AND "aws_credentials"."access_key_id" IS NULL AND "aws_credentials"."secret_access_key_ciphertext" IS NULL));--> statement-breakpoint
-- Deny-by-default for the Data API roles, as every table since 0005.
ALTER TABLE "aws_connections" ENABLE ROW LEVEL SECURITY;
