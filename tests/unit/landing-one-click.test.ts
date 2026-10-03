/**
 * One-click connect is the product's headline. These keep the landing page, the
 * guide and the legal pages telling the same true story, so copy can't quietly
 * promise something the product doesn't do (or keep describing only the old
 * access-key flow).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TROUBLESHOOTING } from "@/lib/guide/content";
import { SESSION_SECONDS } from "@/lib/aws/credentials";
import { CONNECT_ROLE_PREFIX } from "@/lib/aws/connect-template";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const hero = read("src/components/landing/hero.tsx");
const getStarted = read("src/components/landing/get-started.tsx");
const preview = read("src/components/landing/connect-preview.tsx");
const guide = read("src/app/guide/page.tsx");
const terms = read("src/app/terms/page.tsx");
const privacy = read("src/app/privacy/page.tsx");

describe("the landing page leads with one-click", () => {
  it("the hero headline and subhead say so", () => {
    expect(hero).toContain("Connect Amazon SES");
    expect(hero).toContain("in one click.");
    expect(hero).toMatch(/no access keys/i);
    expect(hero).toContain("<ConnectPreview />");
  });

  it("only claims what the code does", () => {
    // Two clicks (Connect AWS, Create stack), a role with no stored secret.
    expect(hero).toContain('"2", "clicks to connect your AWS account"');
    expect(hero).toContain("access keys stored with one-click connect");
    expect(preview).toContain("none stored");
    expect(preview).toContain("Illustrative");
  });

  it("the Get started step explains the role and links the template", () => {
    expect(getStarted).toContain("Create stack");
    expect(getStarted).toContain('href="/aws-connect.yaml"');
    expect(getStarted).toContain("What the role is allowed to do");
  });
});

describe("the guide", () => {
  it("offers one-click first and the access key as the advanced option", () => {
    expect(guide.indexOf("Option A: one-click connect")).toBeGreaterThan(-1);
    expect(guide.indexOf("Option A: one-click connect")).toBeLessThan(guide.indexOf("Option B: an IAM access key"));
    expect(guide).toContain('href="/aws-connect.yaml"');
  });

  it("describes the role the way the code builds it", () => {
    expect(guide).toContain(`${CONNECT_ROLE_PREFIX}…`);
    expect(guide).toMatch(new RegExp(`${SESSION_SECONDS / 60} minutes`));
  });

  it("has troubleshooting for a connect that never finishes, linked from the step", () => {
    expect(TROUBLESHOOTING.map((t) => t.id)).toContain("connect-waiting");
    expect(guide).toContain('href="#connect-waiting"');
  });
});

describe("the legal pages describe both connections", () => {
  it("the Terms cover the role and how to end access", () => {
    expect(terms).toMatch(/IAM role that you create in your account/);
    expect(terms).toMatch(/CloudFormation stack/);
  });

  it("the Privacy Policy says what a one-click connection stores, and that it stores no secret", () => {
    expect(privacy).toMatch(/name \(ARN\) of the IAM role/);
    expect(privacy).toMatch(/No secret is stored/);
    expect(privacy).toContain("AES-256-GCM");
  });
});
