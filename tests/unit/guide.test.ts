/**
 * The /guide page is documentation, so it must not drift from the code it
 * describes. These tests pin its samples and tables to the real contracts: a
 * guide that tells someone to send a request the API refuses is worse than none.
 */
import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "@/lib/api/errors";
import { sendRequestSchema } from "@/lib/api/send-schema";
import { emailStatusEnum } from "@/db/schema";
import {
  ERROR_ROWS,
  REQUEST_FIELDS,
  SEND_EXAMPLE,
  STATUS_ROWS,
  TEMPLATE_EXAMPLE,
  TROUBLESHOOTING,
  curlSample,
  nodeSample,
  pythonSample,
} from "@/lib/guide/content";
import { statusForCode } from "@/lib/api/errors";

describe("guide samples", () => {
  it("send example is a request the API accepts", () => {
    expect(sendRequestSchema.safeParse(SEND_EXAMPLE).success).toBe(true);
  });

  it("template example is a request the API accepts", () => {
    expect(sendRequestSchema.safeParse(TEMPLATE_EXAMPLE).success).toBe(true);
  });

  it("documents every field the API accepts, and no others", () => {
    const accepted = Object.keys(sendRequestSchema.shape).sort();
    expect(REQUEST_FIELDS.map((f) => f.name).sort()).toEqual(accepted);
  });

  it("code samples carry the endpoint, auth header and idempotency key", () => {
    for (const sample of [curlSample("https://x.test"), nodeSample("https://x.test"), pythonSample("https://x.test")]) {
      expect(sample).toContain("https://x.test/api/v1/send");
      expect(sample).toContain("Idempotency-Key");
      expect(sample).toMatch(/Authorization/);
    }
  });
});

describe("guide reference tables", () => {
  it("lists every API error code once, with its real HTTP status", () => {
    const codes = ERROR_ROWS.map((r) => r.code).sort();
    expect(codes).toEqual(Object.values(ERROR_CODES).sort());
    for (const row of ERROR_ROWS) {
      expect(row.status).toBe(statusForCode(row.code as keyof typeof ERROR_CODES));
    }
  });

  it("lists every email status once", () => {
    expect(STATUS_ROWS.map((r) => r.status).sort()).toEqual([...emailStatusEnum.enumValues].sort());
  });

  it("has unique troubleshooting anchors, so deep links can't collide", () => {
    const ids = TROUBLESHOOTING.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
