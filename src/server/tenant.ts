import "server-only";

import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { pgSchema, uuid, varchar } from "drizzle-orm/pg-core";

import { getDb } from "@/db";
import { users, type User } from "@/db/schema";
import { log } from "@/lib/api/logger";
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
 * Supabase's own user table, read only to tell a stale tenant row from a live
 * one. Declared here rather than in the schema so migrations never touch it.
 */
const authUsers = pgSchema("auth").table("users", {
  id: uuid("id").primaryKey(),
  email: varchar("email", { length: 255 }),
});

/**
 * Idempotently mirrors the authenticated Supabase user into `users`.
 * Safe to call on every request; a conflicting email is updated in place.
 */
export async function ensureTenant(
  id: string,
  email: string,
  displayName: string | null,
): Promise<Tenant> {
  try {
    return await upsertTenant(id, email, displayName);
  } catch (error) {
    // The id conflict is handled by the upsert, so this is the email: another
    // tenant row still holds it. Free it, then try once more.
    if (!isUniqueViolation(error)) throw error;
    await releaseStaleEmail(id, email);
    return upsertTenant(id, email, displayName);
  }
}

async function upsertTenant(id: string, email: string, displayName: string | null): Promise<Tenant> {
  const [row] = await getDb()
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
 * Supabase Auth keeps emails unique, so a different tenant row holding this
 * email is out of date. Either its auth user was deleted (the person removed
 * their account and signed up again), so the row and everything under it goes,
 * or that user changed email and hasn't made a request since, so only the
 * mirrored email is corrected. Never deletes a tenant whose auth user exists.
 */
async function releaseStaleEmail(id: string, email: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [holder] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), ne(users.id, id)))
      .limit(1);
    if (!holder) return;

    const [auth] = await tx
      .select({ email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, holder.id))
      .limit(1);

    if (!auth) {
      await tx.delete(users).where(eq(users.id, holder.id));
      log.security("tenant.orphan_removed", holder.id, "auth user deleted; email reused by a new sign-up");
      return;
    }
    if (auth.email && auth.email !== email) {
      await tx.update(users).set({ email: auth.email, updatedAt: sql`now()` }).where(eq(users.id, holder.id));
      return;
    }
    throw new Error("Two auth users share one email; refusing to reconcile tenant rows");
  });
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
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
