import { randomUUID } from "node:crypto";

import { getDb } from "./test-db";
import { users } from "@/db/schema";

/** Creates a tenant row directly, standing in for a Supabase Auth signup. */
export async function createTestUser(email?: string): Promise<string> {
  const id = randomUUID();

  await getDb()
    .insert(users)
    .values({
      id,
      email: email ?? `user-${id.slice(0, 8)}@example.test`,
      displayName: null,
    });

  return id;
}
