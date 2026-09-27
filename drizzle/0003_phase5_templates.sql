CREATE TABLE "email_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"subject" varchar(998) NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text,
	"variables" jsonb,
	"created_by" varchar(320),
	"note" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_logs" ADD COLUMN "template_version" integer;--> statement-breakpoint
ALTER TABLE "email_template_versions" ADD CONSTRAINT "email_template_versions_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template_versions" ADD CONSTRAINT "email_template_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_versions_template_version" ON "email_template_versions" USING btree ("template_id","version");