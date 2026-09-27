import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { awsCredentials, environmentEnum, type Environment } from "@/db/schema";

/**
 * The dashboard's active environment — Phase 4 "environment switching".
 *
 * A cookie holds the choice, which is only a view preference: it decides which
 * environment's data a page shows, never which data a user may see. Every query
 * is still scoped by the tenant from the verified session.
 *
 * With no cookie, the default is the environment that actually has an active
 * credential (production first), so a new user who set up staging only does
 * not land on an empty production dashboard.
 */
export const ENV_COOKIE = "ops_env";

export function isEnvironment(value: unknown): value is Environment {
  return (
    typeof value === "string" &&
    (environmentEnum.enumValues as readonly string[]).includes(value)
  );
}

export async function getActiveEnvironment(
  userId: string,
): Promise<Environment> {
  const chosen = (await cookies()).get(ENV_COOKIE)?.value;
  if (isEnvironment(chosen)) return chosen;

  const rows = await getDb()
    .select({ environment: awsCredentials.environment })
    .from(awsCredentials)
    .where(and(eq(awsCredentials.userId, userId), eq(awsCredentials.active, true)));

  const configured = new Set(rows.map((r) => r.environment));
  if (configured.has("production")) return "production";
  if (configured.has("staging")) return "staging";
  return "production";
}

export async function setActiveEnvironment(env: Environment): Promise<void> {
  (await cookies()).set(ENV_COOKIE, env, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 3600,
  });
}
