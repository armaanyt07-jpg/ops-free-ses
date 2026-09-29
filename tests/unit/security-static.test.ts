import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 7 — static security guards. Cheap checks over the source tree that
 * fail the build when a new file breaks a rule the design depends on, instead
 * of waiting for someone to notice in review.
 */
const ROOT = join(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => relative(ROOT, f);

describe("Server Actions authenticate", () => {
  // login/actions.ts is the sign-in entry point: it authenticates the caller
  // against Supabase itself and has no tenant yet. Everything else must.
  const actionFiles = files.filter(
    (f) =>
      /^\s*["']use server["'];?/m.test(read(f).split("\n").slice(0, 3).join("\n")) &&
      !f.endsWith("src/app/login/actions.ts"),
  );

  it("finds the action modules", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(8);
  });

  it("the login actions accept no user or tenant id from the form", () => {
    const login = read(join(SRC, "app/login/actions.ts"));
    expect(login).not.toMatch(/formData\.get\(["'](userId|user_id|tenant|id)["']\)/);
  });

  // Every exported action is a public HTTP endpoint. It must establish the
  // caller from the session itself — never trust an id from the form.
  it.each(actionFiles.map((f) => [rel(f), f]))("%s: every exported action calls requireTenant()", (_name, file) => {
    const source = read(file);
    const fns = [...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{/g)];
    expect(fns.length).toBeGreaterThan(0);
    for (const match of fns) {
      const start = match.index! + match[0].length;
      const body = source.slice(start, start + 600);
      const delegates = /return change\(/.test(body); // suppression actions delegate to one authenticated helper
      expect(body.includes("requireTenant()") || delegates, `${match[1]} does not call requireTenant()`).toBe(true);
    }
  });
});

describe("API routes authenticate", () => {
  // Each public route and the mechanism that authenticates it. A new route
  // must be added here deliberately, with its mechanism.
  const ROUTES: Record<string, RegExp> = {
    "src/app/api/v1/send/route.ts": /authenticateApiKey\(/,
    "src/app/api/v1/domains/verify/route.ts": /authenticateApiKey\(/,
    "src/app/api/v1/webhooks/aws-sns/route.ts": /verifySnsSignature\(/,
    "src/app/auth/signout/route.ts": /request\.nextUrl\.origin/,
    // Public by design (platform probes); reveal only ok/fail, no error text.
    "src/app/api/health/route.ts": /liveness/,
    "src/app/api/health/ready/route.ts": /readiness[\s\S]*never error text/,
  };

  const routes = files.filter((f) => f.endsWith("/route.ts")).map(rel).sort();

  it("every route is in the reviewed list", () => {
    expect(routes).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(Object.entries(ROUTES))("%s uses its auth mechanism", (path, mechanism) => {
    expect(read(join(ROOT, path))).toMatch(mechanism);
  });

  it("public API routes apply the per-IP limit", () => {
    for (const path of ["send", "domains/verify", "webhooks/aws-sns"]) {
      expect(read(join(SRC, "app/api/v1", path, "route.ts"))).toMatch(/checkLimit\(/);
    }
  });
});

describe("secrets stay on the server", () => {
  it("every src/server module is server-only", () => {
    for (const f of files.filter((f) => f.includes("/src/server/"))) {
      expect(read(f), rel(f)).toMatch(/^import "server-only";/m);
    }
  });

  it("client components import nothing from src/server or the DB", () => {
    for (const f of files.filter((f) => /^\s*["']use client["']/m.test(read(f).split("\n")[0] ?? ""))) {
      const source = read(f);
      expect(source, rel(f)).not.toMatch(/from "@\/server\//);
      expect(source, rel(f)).not.toMatch(/from "@\/db"/);
      expect(source, rel(f)).not.toMatch(/process\.env\.(?!NEXT_PUBLIC_)/);
    }
  });

  it("only the two Supabase public values are NEXT_PUBLIC_", () => {
    const used = new Set(files.flatMap((f) => [...read(f).matchAll(/NEXT_PUBLIC_[A-Z_]+/g)].map((m) => m[0])));
    expect([...used].sort()).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("nothing renders raw HTML into the dashboard or evaluates code", () => {
    for (const f of files) {
      expect(read(f), rel(f)).not.toMatch(/dangerouslySetInnerHTML|\beval\(|new Function\(/);
    }
  });

  it("template previews are sandboxed iframes", () => {
    for (const f of files) {
      for (const tag of read(f).match(/<iframe[\s\S]*?\/>/g) ?? []) {
        expect(tag, rel(f)).toMatch(/sandbox=""/);
      }
    }
  });
});
