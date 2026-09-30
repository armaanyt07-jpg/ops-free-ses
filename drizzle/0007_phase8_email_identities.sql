CREATE TABLE "email_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"environment" "environment" NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"aws_region" varchar(32) NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_identities" ADD CONSTRAINT "email_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_identities_user_email_env" ON "email_identities" USING btree ("user_id","email","environment");--> statement-breakpoint
-- Deny-by-default for the Data API roles, as every table since 0005.
ALTER TABLE "email_identities" ENABLE ROW LEVEL SECURITY;
