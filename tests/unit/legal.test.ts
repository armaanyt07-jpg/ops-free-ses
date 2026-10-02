/**
 * The Terms and Privacy Policy make factual claims about how the product works.
 * These tests pin the claims that can be checked against code, so the policy
 * can't quietly stop being true. They can't check the legal wording itself:
 * that needs a person.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { emailLogs } from "@/db/schema";
import { LEGAL, unresolvedLegalFields } from "@/lib/legal/config";
import { DEFAULT_JOB_OPTIONS } from "@/lib/queue/send-queue";
import { COMPLETED_JOB_RETENTION_HOURS, FAILED_JOB_RETENTION_DAYS } from "@/lib/queue/retention";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const privacy = read("src/app/privacy/page.tsx");
const terms = read("src/app/terms/page.tsx");
const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

describe("placeholders", () => {
  it("finds every bracketed value and nothing else", () => {
    expect(unresolvedLegalFields({ a: "[FILL ME]", b: "real value", c: "[ALSO, with comma]", d: "has [brackets] inside" })).toEqual(["a", "c"]);
  });

  it("is empty once everything is filled in", () => {
    expect(unresolvedLegalFields({ a: "Acme Ltd", b: "legal@example.com" })).toEqual([]);
  });

  it("every LEGAL field the pages use exists, so none can render as undefined", () => {
    for (const source of [privacy, terms]) {
      for (const [, key] of source.matchAll(/LEGAL\.(\w+)/g)) {
        expect(Object.keys(LEGAL), `LEGAL.${key}`).toContain(key);
      }
    }
  });

  it("the facts only the operator knows are placeholders until filled", () => {
    // If this fails because someone filled one in, update the list: that's the point.
    expect(unresolvedLegalFields()).toEqual(
      expect.arrayContaining(["operator", "postalAddress", "governingLaw"]),
    );
  });
});

describe("the Privacy Policy matches the code", () => {
  it("quotes the real queue retention, from the same constants the queue uses", () => {
    expect(privacy).toContain("COMPLETED_JOB_RETENTION_HOURS");
    expect(privacy).toContain("FAILED_JOB_RETENTION_DAYS");
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toMatchObject({ age: COMPLETED_JOB_RETENTION_HOURS * 3600 });
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toMatchObject({ age: FAILED_JOB_RETENTION_DAYS * 24 * 3600 });
  });

  it("is true that message bodies are not stored in the email log table", () => {
    const columns = Object.keys(getTableColumns(emailLogs)).map((c) => c.toLowerCase());
    for (const body of ["html", "text", "body", "content", "htmlbody", "textbody"]) {
      expect(columns).not.toContain(body);
    }
  });

  it("is true that the site runs no third-party analytics or ad trackers", () => {
    const trackers = ["posthog-js", "react-ga", "react-ga4", "@vercel/analytics", "mixpanel-browser", "@segment/analytics-next", "plausible-tracker", "hotjar", "@amplitude/analytics-browser", "@datadog/browser-rum"];
    for (const t of trackers) expect(deps, t).not.toContain(t);
    expect(read("src/app/layout.tsx")).not.toMatch(/googletagmanager|gtag\(|analytics\.js/i);
  });

  it("names every provider the app actually depends on", () => {
    expect(deps).toContain("@supabase/ssr");
    expect(deps).toContain("@sentry/nextjs");
    expect(deps).toContain("bullmq");
    for (const name of ["Supabase", "Vercel", "Railway", "Upstash", "Sentry", "Amazon Web Services"]) {
      expect(privacy, name).toContain(name);
    }
  });

  it("says secrets are encrypted with the algorithm the code uses", () => {
    expect(privacy).toContain("AES-256-GCM");
    expect(read("src/lib/crypto/encryption.ts")).toMatch(/aes-256-gcm/i);
  });

  it("says API keys are stored as one-way hashes, as the code does", () => {
    expect(privacy).toMatch(/one-way hash/);
    expect(read("src/lib/crypto/api-key.ts")).toMatch(/createHash\("sha256"\)/);
  });
});

describe("the Terms match the product", () => {
  it("points to the Privacy Policy and says the service is a free beta with no uptime guarantee", () => {
    expect(terms).toContain('href="/privacy"');
    expect(terms).toMatch(/During the beta the service is free/);
    expect(terms).toMatch(/no uptime or delivery-time guarantee/);
  });

  it("does not promise that AWS will grant production access", () => {
    expect(terms).toMatch(/can’t\s+promise or influence the outcome/);
    expect(terms).not.toMatch(/we (will|can) (get|obtain|secure) (you )?production access/i);
  });
});
