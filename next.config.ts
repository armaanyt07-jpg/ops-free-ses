import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Leave the queue stack as native Node requires instead of bundling it.
   *
   * BullMQ soft-requires alternative Redis backends (`@valkey/valkey-glide`,
   * `redis`, `pg`) that are not installed — we use ioredis. Those are runtime
   * branches BullMQ never takes, but a bundler has to resolve every import it
   * can see, so webpack reported:
   *
   *   Module not found: Can't resolve '@valkey/valkey-glide'
   *
   * Marking the packages external means Node resolves them at runtime, where
   * the untaken branches are simply never required. This is also correct for
   * ioredis independently: it pulls in native bindings that should not be
   * bundled.
   */
  serverExternalPackages: ["bullmq", "ioredis"],
};

export default nextConfig;
