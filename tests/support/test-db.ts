import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/db/schema";

/**
 * Test database.
 *
 * Vitest aliases `@/db` here, so the real repositories under `src/server` run
 * unmodified against PGlite — PostgreSQL compiled to WebAssembly. Unique
 * indexes, enums, foreign keys, `ON CONFLICT` and `gen_random_uuid()` all
 * behave as they do in production, which is the point: these are the
 * constraints the idempotency and tenant-isolation guarantees rely on.
 *
 * The schema is created by running the same generated migrations that ship to
 * Supabase, so a migration that would fail in production fails here first.
 */
type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

let client: PGlite | undefined;
let db: TestDatabase | undefined;
let migrated: Promise<void> | undefined;

export function getDb(): TestDatabase {
  if (!db) {
    client = new PGlite();
    db = drizzle(client, { schema });
  }
  return db;
}

/** Applies `drizzle/` migrations once per test process. */
export function migrateTestDb(): Promise<void> {
  if (!migrated) {
    migrated = migrate(getDb(), {
      migrationsFolder: resolve(import.meta.dirname, "../../drizzle"),
    });
  }
  return migrated;
}

/** Truncates every application table between tests. */
export async function resetTestDb(): Promise<void> {
  await migrateTestDb();
  // `users` cascades to every other table via its foreign keys.
  await getDb().execute(
    "TRUNCATE TABLE users, aws_credentials, verified_domains, email_templates, email_logs, suppression_list, api_keys, sns_topics, sns_events, audit_logs, email_template_versions, sandbox_requests RESTART IDENTITY CASCADE",
  );
}

export async function closeTestDb(): Promise<void> {
  await client?.close();
  client = undefined;
  db = undefined;
  migrated = undefined;
}

export { schema };
export type { TestDatabase as Database };
