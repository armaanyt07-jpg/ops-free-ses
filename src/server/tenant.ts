import "server-only";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { users, type User } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * Tenant resolution.
 *
 * Supabase Auth owns identity; `users` owns the tenant record that every other
 * table is foreign-keyed to. The two are reconciled here, on the way in, so a
 * user created by any Supabase flow (password, OAuth, invite) always has a
 * matching tenant row by the time application code runs.
 *
 * The tenant id IS the Supabase auth user id, which keeps ownership checks a
 * simple equality against the verified session rather than a lookup that could
 * be spoofed.
 */
export interface Tenant {
  id: string;
  email: string;
  displayName: string | null;
}

function toTenant(row: User): Tenant {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

/**
 * Idempotently mirrors the authenticated Supabase user into `users`.
 * Safe to call on every request; a conflicting email is updated in place.
 */
export async function ensureTenant(
  id: string,
  email: string,
  displayName: string | null,
): Promise<Tenant> {
  const db = getDb();

  const [row] = await db
    .insert(users)
    .values({ id, email, displayName })
    .onConflictDoUpdate({
      target: users.id,
      set: { email, displayName, updatedAt: sql`now()` },
    })
    .returning();

  if (!row) {
    throw new Error("Failed to materialise tenant record");
  }

  return toTenant(row);
}

/**
 * Returns the current tenant, or null when unauthenticated.
 * Uses getUser() so the JWT is revalidated against the auth server.
 */
export async function getTenant(): Promise<Tenant | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  const displayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : null;

  return ensureTenant(user.id, user.email, displayName);
}

/** Server Component / Server Action guard. Redirects instead of throwing. */
export async function requireTenant(): Promise<Tenant> {
  const tenant = await getTenant();
  if (!tenant) redirect("/login");
  return tenant;
}
