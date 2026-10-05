import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { suppressionList, users } from "@/db/schema";

import { createTestUser } from "../support/factories";
import { closeTestDb, getDb, resetTestDb } from "../support/test-db";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { ensureTenant } = await import("@/server/tenant");

/**
 * Re-signing up with an email whose old tenant row survived (the auth user was
 * deleted, the `users` row wasn't) used to crash every page on the unique
 * email. PGlite has no Supabase `auth` schema, so a minimal stand-in is made.
 */
async function addAuthUser(id: string, email: string) {
  await getDb().execute(`INSERT INTO auth.users (id, email) VALUES ('${id}', '${email}')`);
}

beforeAll(async () => {
  await resetTestDb();
  await getDb().execute("CREATE SCHEMA IF NOT EXISTS auth");
  await getDb().execute("CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email varchar(255))");
});

beforeEach(async () => {
  await resetTestDb();
  await getDb().execute("TRUNCATE auth.users");
});

afterAll(closeTestDb);

describe("ensureTenant", () => {
  it("creates the row, then updates it in place on later calls", async () => {
    const id = randomUUID();
    await ensureTenant(id, "a@example.test", null);
    const t = await ensureTenant(id, "a@example.test", "Armaan");
    expect(t).toEqual({ id, email: "a@example.test", displayName: "Armaan" });
  });

  it("replaces an orphaned row when its email signs up again", async () => {
    const oldId = await createTestUser("again@example.test");
    await getDb().insert(suppressionList).values({ userId: oldId, email: "x@example.test", reason: "bounce" });

    const newId = randomUUID();
    await addAuthUser(newId, "again@example.test");
    const t = await ensureTenant(newId, "again@example.test", null);

    expect(t.id).toBe(newId);
    expect(await getDb().select().from(users).where(eq(users.id, oldId))).toHaveLength(0);
    // The old account's data went with it.
    expect(await getDb().select().from(suppressionList)).toHaveLength(0);
  });

  it("never deletes a live account; it corrects that account's stale email instead", async () => {
    // A changed email in Supabase (to new@) but hasn't made a request since,
    // so its tenant row still says old@. B then signs up as old@.
    const a = await createTestUser("old@example.test");
    await addAuthUser(a, "new@example.test");
    await getDb().insert(suppressionList).values({ userId: a, email: "x@example.test", reason: "bounce" });

    const b = randomUUID();
    await addAuthUser(b, "old@example.test");
    await ensureTenant(b, "old@example.test", null);

    const [rowA] = await getDb().select().from(users).where(eq(users.id, a));
    expect(rowA?.email).toBe("new@example.test");
    expect(await getDb().select().from(suppressionList).where(eq(suppressionList.userId, a))).toHaveLength(1);
  });
});
