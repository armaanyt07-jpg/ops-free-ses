CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor" varchar(320) NOT NULL,
	"action" varchar(64) NOT NULL,
	"target" varchar(320) NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aws_credentials" ADD COLUMN "account_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_user_created" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "email_logs_user_env_queued" ON "email_logs" USING btree ("user_id","environment","queued_at");