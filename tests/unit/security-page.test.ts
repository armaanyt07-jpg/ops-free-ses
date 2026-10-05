/**
 * The security page is how a visitor decides whether to connect AWS, so it has
 * to be reachable signed out and linked from the footer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("security page", () => {
  it("is public, so signed-out visitors aren't sent to sign in", () => {
    expect(read("src/lib/supabase/middleware.ts")).toMatch(/PUBLIC_PATHS = \[[^\]]*"\/security"/);
  });

  it("is linked from the footer", () => {
    expect(read("src/components/landing/footer.tsx")).toContain('href: "/security"');
  });
});
