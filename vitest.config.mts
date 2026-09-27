import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  // Pages are server-rendered in tests/integration/pages-render.test.ts. The
  // project tsconfig preserves JSX for Next.js, so Vitest compiles it here.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: [
      /*
       * `server-only` throws by design outside the React Server environment.
       * Under Vitest the modules it guards are exactly what we want to test,
       * so it is stubbed out here. The guard still applies to real builds.
       */
      {
        find: /^server-only$/,
        replacement: resolve(root, "tests/support/server-only-stub.ts"),
      },
      /*
       * Exact-match so `@/db/schema` still resolves normally. Integration
       * tests run the real repositories against PGlite — an actual PostgreSQL
       * build, not a mock — with the same generated migrations that production
       * uses.
       */
      {
        find: /^@\/db$/,
        replacement: resolve(root, "tests/support/test-db.ts"),
      },
      { find: /^@\//, replacement: `${resolve(root, "src")}/` },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["tests/support/setup.ts"],
    include: ["tests/**/*.test.ts"],
    pool: "forks",
  },
});
