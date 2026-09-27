CREATE TABLE "sandbox_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" "environment" NOT NULL,
	"answers" jsonb NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" varchar(320),
	"reviewed_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_requests" ADD CONSTRAINT "sandbox_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_requests_user_env" ON "sandbox_requests" USING btree ("user_id","environment");