/**
 * Pre-deploy checks against the TARGET environment — Phase 7.
 *
 *   npm run preflight          # uses .env.local, or the process environment
 *
 * Exits non-zero if anything a production deployment depends on is wrong.
 * Prints names and pass/fail only — never a value.
 */
import { readdirSync } from "node:fs";

import { config } from "dotenv";

config({ path: ".env.local" });

type Result = { check: string; ok: boolean; detail: string };
const results: Result[] = [];
const record = (check: string, ok: boolean, detail = "") => results.push({ check, ok, detail });

async function attempt(check: string, fn: () => Promise<string>) {
  try {
    record(check, true, await fn());
  } catch (error) {
    record(check, false, error instanceof Error ? error.message.slice(0, 160) : "failed");
  }
}

void (async () => {
  const { serverEnv, publicEnv } = await import("@/lib/env");
  const { loadMasterKey, decryptWithKeyring } = await import("@/lib/crypto/encryption");

  await attempt("server environment variables", async () => {
    const env = serverEnv();
    return env.ENCRYPTION_KEY_PREVIOUS ? "valid (key rotation in progress: ENCRYPTION_KEY_PREVIOUS set)" : "valid";
  });
  await attempt("public Supabase variables", async () => (publicEnv(), "valid"));
  await attempt("REDIS_URL", async () => {
    const url = process.env.REDIS_URL ?? "";
    if (!/^rediss?:\/\//.test(url)) throw new Error("must be redis:// or rediss://");
    return url.startsWith("rediss://") ? "TLS (rediss://)" : "plain redis:// — acceptable only on a private network";
  });
  await attempt("ENCRYPTION_KEY is a 32-byte key", async () => (loadMasterKey(serverEnv().ENCRYPTION_KEY), "ok"));

  const postgres = (await import("postgres")).default;
  const sql = postgres(serverEnv().DATABASE_URL, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    await attempt("database reachable", async () => (await sql`select 1`, "ok"));

    await attempt("all migrations applied", async () => {
      const files = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).length;
      const [row] = await sql`select count(*)::int n from drizzle.__drizzle_migrations`;
      if (row!.n !== files) throw new Error(`${row!.n} applied, ${files} in drizzle/ — run npm run db:migrate`);
      return `${files}/${files}`;
    });

    // The critical one: Supabase's Data API must expose nothing (see docs/security/AUDIT.md F-01).
    await attempt("Data API exposes no tables (anon/authenticated grants)", async () => {
      const [row] = await sql`select count(*)::int n from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')`;
      if (row!.n > 0) throw new Error(`${row!.n} grants to anon/authenticated — apply migration 0005`);
      return "none";
    });
    await attempt("row-level security on every table", async () => {
      const rows = await sql`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`;
      if (rows.length > 0) throw new Error(`missing on: ${rows.map((r) => r.relname).join(", ")}`);
      return "enabled";
    });

    await attempt("stored credentials decrypt with the configured key(s)", async () => {
      const env = serverEnv();
      const keys = [loadMasterKey(env.ENCRYPTION_KEY), ...(env.ENCRYPTION_KEY_PREVIOUS ? [loadMasterKey(env.ENCRYPTION_KEY_PREVIOUS)] : [])];
      const rows = await sql`select user_id, environment, secret_access_key_ciphertext c from aws_credentials`;
      let bad = 0;
      for (const r of rows) {
        try {
          decryptWithKeyring(r.c as string, keys, { userId: r.user_id as string, environment: r.environment as "production" | "staging" });
        } catch {
          bad += 1;
        }
      }
      if (bad > 0) throw new Error(`${bad} of ${rows.length} cannot be decrypted — wrong ENCRYPTION_KEY?`);
      return `${rows.length} credential(s) ok`;
    });
  } finally {
    await sql.end();
  }

  const { Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL ?? "redis://invalid", { lazyConnect: true, maxRetriesPerRequest: 1, enableReadyCheck: false, connectTimeout: 5_000 });
  redis.on("error", () => undefined);
  try {
    await attempt("Redis reachable", async () => (await redis.connect(), await redis.ping(), "ok"));
    // The rate limiter reads Redis TIME inside Lua; some managed Redis
    // providers forbid non-deterministic commands in scripts (docs/PHASE-2.md).
    await attempt("Redis allows TIME inside Lua (rate limiter)", async () => {
      const t = (await redis.eval("return redis.call('TIME')", 0)) as unknown[];
      if (!Array.isArray(t) || t.length !== 2) throw new Error("unexpected TIME reply");
      return "ok";
    });
  } finally {
    redis.disconnect();
  }

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}${r.detail ? `  — ${r.detail}` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed — do not deploy.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
})();
