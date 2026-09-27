CREATE TYPE "public"."domain_status" AS ENUM('pending', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('staging', 'production');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"key_hash" text NOT NULL,
	"environment" "environment" NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aws_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"access_key_id" varchar(128) NOT NULL,
	"secret_access_key_ciphertext" text NOT NULL,
	"aws_region" varchar(32) NOT NULL,
	"ses_max_send_rate" integer,
	"active" boolean DEFAULT true NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" varchar(255),
	"message_id" varchar(255),
	"ses_request_id" varchar(255),
	"from_address" varchar(320) NOT NULL,
	"recipients" jsonb NOT NULL,
	"subject" varchar(998) NOT NULL,
	"template_id" uuid,
	"tags" jsonb,
	"error_code" varchar(120),
	"error_message" text,
	"provider_event" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"subject" varchar(998) NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text,
	"variables" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"reason" varchar(40) NOT NULL,
	"source_event_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verified_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"environment" "environment" NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"ses_identity_arn" text,
	"dkim_tokens" jsonb,
	"spf_record" text,
	"dmarc_record" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aws_credentials" ADD CONSTRAINT "aws_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_domains" ADD CONSTRAINT "verified_domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_env" ON "api_keys" USING btree ("user_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "aws_credentials_user_env" ON "aws_credentials" USING btree ("user_id","environment");--> statement-breakpoint
CREATE INDEX "email_logs_user_queued" ON "email_logs" USING btree ("user_id","queued_at");--> statement-breakpoint
CREATE INDEX "email_logs_message" ON "email_logs" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_logs_user_idempotency" ON "email_logs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_user_name" ON "email_templates" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_user_email" ON "suppression_list" USING btree ("user_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "verified_domains_user_domain_env" ON "verified_domains" USING btree ("user_id","domain","environment");