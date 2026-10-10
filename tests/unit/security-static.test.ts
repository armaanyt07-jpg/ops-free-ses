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
    // Phase 10: signature AND our exact topic; the message is a hint, proven
    // later by assuming the role. Response URL is restricted to AWS buckets.
    "src/app/api/v1/webhooks/aws-connect/route.ts": /verifySnsSignature\([\s\S]*platform\.topicArn[\s\S]*isTrustedResponseUrl\(/,
    // Public by design: the customer-facing CloudFormation template, so it can be read first.
    "src/app/aws-connect.yaml/route.ts": /buildConnectTemplate\(\)/,
    "src/app/auth/signout/route.ts": /request\.nextUrl\.origin/,
    // Starts Google sign-in. Creates no session and takes no credentials; `next` is
    // restricted to same-site paths, so it is not an open redirect.
    "src/app/auth/google/route.ts": /signInWithOAuth\([\s\S]*googleRedirectTo\(/,
    // Authenticated by the one-time token in the emailed link; `next` is
    // restricted to same-site paths so the route is not an open redirect.
    "src/app/auth/confirm/route.ts": /safeNextPath\([\s\S]*exchangeCodeForSession\(/,
    // Public by design: the free DNS checker. No account, so it is per-IP limited before
    // any lookup, reads only public DNS, and stores nothing (marketing.test.ts pins that).
    "src/app/api/tools/dns-check/route.ts": /checkLimit\("dnsTool"[\s\S]*checkDns\(/,
    // Public by design (platform probes); reveal only ok/fail, no error text.
    "src/app/api/health/route.ts": /liveness/,
    "src/app/api/health/ready/route.ts": /readiness[\s\S]*never error text/,
    "src/app/api/health/worker/route.ts": /worker heartbeats[\s\S]*never error text/,
  };

  const routes = files.filter((f) => f.endsWith("/route.ts")).map(rel).sort();

  it("every route is in the reviewed list", () => {
    expect(routes).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(Object.entries(ROUTES))("%s uses its auth mechanism", (path, mechanism) => {
    expect(read(join(ROOT, path))).toMatch(mechanism);
  });

  it("public API routes apply the per-IP limit", () => {
    for (const path of ["send", "domains/verify", "webhooks/aws-sns", "webhooks/aws-connect"]) {
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

  it("only the reviewed public values are NEXT_PUBLIC_", () => {
    // Each is public by design: the Supabase URL and anon key (RLS guards the
    // data), the Sentry DSN (it can submit events, never read them), and the
    // Turnstile site key (it only identifies the widget; verification needs the
    // secret key, which lives in the Supabase dashboard and never in this app),
    // and the Google sign-in switch (a boolean; the Google client secret lives
    // in the Supabase dashboard too).
    const used = new Set(files.flatMap((f) => [...read(f).matchAll(/NEXT_PUBLIC_[A-Z_]+/g)].map((m) => m[0])));
    expect([...used].sort()).toEqual([
      "NEXT_PUBLIC_GOOGLE_SIGNIN",
      "NEXT_PUBLIC_SENTRY_DSN",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    ]);
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
