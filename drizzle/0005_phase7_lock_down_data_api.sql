-- Phase 7 security fix: close Supabase's Data API over the application schema.
--
-- Supabase exposes every table in `public` through its REST (PostgREST) API to
-- the `anon` and `authenticated` roles. The anon key is public by design — it
-- ships in the browser bundle — and until this migration those roles held
-- SELECT, INSERT, UPDATE, DELETE and TRUNCATE on every table, with no row-level
-- security. Anyone could read credentials rows and user emails, insert an API
-- key for any tenant, or truncate the database.
--
-- This application never uses the Data API: the server connects as `postgres`
-- (the table owner, which bypasses RLS). So the correct policy is "no access
-- at all" for the API roles:
--
--   1. revoke every privilege they hold on existing objects;
--   2. revoke the default privileges, so tables created later do not inherit
--      access (this was how the grants arrived in the first place);
--   3. enable row-level security on every table with no policies — deny by
--      default — so that even a future accidental GRANT exposes nothing.
--
-- The role checks make this a no-op on databases without Supabase's roles
-- (the PGlite test database), so the same migration runs everywhere.

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "aws_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verified_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppression_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sns_topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sns_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sandbox_requests" ENABLE ROW LEVEL SECURITY;
