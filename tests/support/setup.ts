import { randomBytes } from "node:crypto";

/**
 * Test environment.
 *
 * A fresh master key is generated per test process. Nothing here is a real
 * credential, and no test reaches AWS or a hosted database: SES is mocked and
 * PostgreSQL is PGlite.
 */
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
