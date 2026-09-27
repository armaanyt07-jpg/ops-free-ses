import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Database handle.
 *
 * Created lazily and cached on `globalThis` so that Next.js dev-server module
 * reloads do not open a new pool on every edit.
 *
 * `prepare: false` is required when connecting through Supabase's transaction
 * pooler (PgBouncer), which does not support prepared statements.
 */
type Database = ReturnType<typeof createDatabase>;

function createDatabase() {
  const { DATABASE_URL } = serverEnv();

  const client = postgres(DATABASE_URL, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

const globalForDb = globalThis as unknown as {
  __opsDb?: Database;
};

export function getDb(): Database {
  if (!globalForDb.__opsDb) {
    globalForDb.__opsDb = createDatabase();
  }
  return globalForDb.__opsDb;
}

export { schema };
export type { Database };
