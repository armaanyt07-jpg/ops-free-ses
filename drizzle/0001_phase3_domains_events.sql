CREATE TABLE "sns_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar(128) NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_arn" varchar(320) NOT NULL,
	"message_type" varchar(40) NOT NULL,
	"event_type" varchar(40),
	"ses_message_id" varchar(255),
	"log_id" uuid,
	"event_at" timestamp with time zone,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sns_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_arn" varchar(320) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"subscription_arn" varchar(512),
	"confirmed_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verified_domains" ADD COLUMN "aws_region" varchar(32);--> statement-breakpoint
ALTER TABLE "verified_domains" ADD COLUMN "check_result" jsonb;--> statement-breakpoint
ALTER TABLE "sns_events" ADD CONSTRAINT "sns_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sns_events" ADD CONSTRAINT "sns_events_log_id_email_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."email_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sns_topics" ADD CONSTRAINT "sns_topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sns_events_message_id" ON "sns_events" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "sns_events_user_ses_message" ON "sns_events" USING btree ("user_id","ses_message_id");--> statement-breakpoint
CREATE INDEX "sns_events_user_received" ON "sns_events" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sns_topics_topic_arn" ON "sns_topics" USING btree ("topic_arn");--> statement-breakpoint
CREATE INDEX "sns_topics_user" ON "sns_topics" USING btree ("user_id");