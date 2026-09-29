import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeTestDb, getDb, migrateTestDb } from "../support/test-db";

/**
 * Runs the generated `drizzle/` migrations against a real PostgreSQL engine
 * and asserts the structures the application's guarantees depend on actually
 * exist. A schema change that drops one of these indexes silently removes an
 * invariant, so they are asserted rather than assumed.
 */
beforeAll(async () => {
  await migrateTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

async function rows<T>(sql: string): Promise<T[]> {
  const result = await getDb().execute(sql);
  return result.rows as T[];
}

describe("migrations", () => {
  it("creates every table in the SRS §6 baseline", async () => {
    const found = await rows<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = new Set(found.map((r) => r.table_name));

    for (const table of [
      "users",
      "aws_credentials",
      "verified_domains",
      "email_templates",
      "email_logs",
      "suppression_list",
      "api_keys",
      // Phase 3
      "sns_topics",
      "sns_events",
    ]) {
      expect(names.has(table), `missing table: ${table}`).toBe(true);
    }
  });

  it("creates the three enums with the SRS value sets", async () => {
    const found = await rows<{ typname: string; labels: string[] }>(`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      GROUP BY t.typname
    `);
    const byName = Object.fromEntries(found.map((r) => [r.typname, r.labels]));

    expect(byName["environment"]).toEqual(["staging", "production"]);
    expect(byName["domain_status"]).toEqual(["pending", "verified", "failed"]);
    expect(byName["email_status"]).toEqual([
      "queued",
      "sending",
      "sent",
      "delivered",
      "bounced",
      "complained",
      "failed",
      "suppressed",
    ]);
  });

  it.each([
    "aws_credentials_user_env",
    "email_logs_user_idempotency",
    "api_keys_hash",
    "suppression_user_email",
    "email_templates_user_name",
    "verified_domains_user_domain_env",
    // Phase 3: webhook idempotency and single-tenant topic ownership rest on
    // these two. Losing either silently removes the guarantee.
    "sns_events_message_id",
    "sns_topics_topic_arn",
  ])("creates the unique index %s", async (indexName) => {
    const found = await rows<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = '${indexName}'`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.indexdef).toContain("UNIQUE");
  });

  it("cascades tenant deletion to every owned table", async () => {
    const found = await rows<{ table_name: string; delete_rule: string }>(`
      SELECT tc.table_name, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'user_id'
    `);

    expect(found.length).toBeGreaterThanOrEqual(6);
    for (const row of found) {
      expect(row.delete_rule).toBe("CASCADE");
    }
  });

  it("adds the Phase 3 verified_domains columns as nullable", async () => {
    const found = await rows<{ column_name: string; is_nullable: string }>(`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'verified_domains'
        AND column_name IN ('aws_region', 'check_result')
    `);
    expect(found.map((r) => r.column_name).sort()).toEqual([
      "aws_region",
      "check_result",
    ]);
    for (const row of found) expect(row.is_nullable).toBe("YES");
  });

  // Phase 7 security fix. Supabase's Data API exposes every `public` table to
  // the anon role; RLS with no policies is the deny-by-default backstop. A new
  // table created without it fails here instead of silently reopening the hole.
  it("enables row-level security on every application table", async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(`
      SELECT c.relname, c.relrowsecurity FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `);
    expect(tables.length).toBeGreaterThanOrEqual(12);
    const without = tables.filter((t) => !t.relrowsecurity).map((t) => t.relname);
    expect(without, `tables without RLS: ${without.join(", ")}`).toEqual([]);
  });

  it("is idempotent when applied twice", async () => {
    await expect(migrateTestDb()).resolves.not.toThrow();
  });
});
