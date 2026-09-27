/**
 * `server-only` shim for the worker process.
 *
 * The real package throws on import outside a React Server Component, which is
 * exactly what makes it a useful guard for the Next.js bundle. The worker is a
 * standalone Node process, not a bundle, so the guard is mapped to this empty
 * module via `tsconfig.worker.json` paths.
 *
 * The guard still applies with full force to the Next.js build — this file is
 * only reachable through the worker's tsconfig.
 */
export {};
