import { z } from "zod";

/**
 * Environment contract.
 *
 * `serverEnv()` is lazy so that importing a module that touches config does not
 * crash a build step that never needs it. Values are validated once and cached.
 *
 * Nothing in this file may be imported from a Client Component: it reads
 * secrets (SRS §9 — AWS and database secrets stay strictly server-side).
 */
const serverSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (v) => v.startsWith("postgres://") || v.startsWith("postgresql://"),
      "DATABASE_URL must be a PostgreSQL connection string",
    ),
  /** Base64-encoded 32-byte master key for AES-256-GCM credential encryption. */
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY is required"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

let cachedServerEnv: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    // Names only. Never echo values: they are secrets.
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid server environment — ${missing}`);
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/**
 * Public Supabase config. These are referenced statically so Next.js can inline
 * them into the client bundle; both values are safe to expose by design.
 */
export function publicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      "Invalid Supabase public environment — NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set",
    );
  }

  return parsed.data;
}
