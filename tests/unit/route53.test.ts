import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route 53 DKIM publishing — Phase 8. Best effort: every outcome is a value,
 * never an exception, because a failure only means "publish by hand".
 */
const r53 = vi.hoisted(() => ({
  zones: [] as Array<{ Id: string; Name: string; Config?: { PrivateZone: boolean } }>,
  calls: [] as Array<{ op: string; input: Record<string, unknown> }>,
  fail: null as Error | null,
}));

vi.mock("@aws-sdk/client-route-53", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-route-53")>()),
  Route53Client: vi.fn(function () {
    return {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const op = command.constructor.name.replace(/Command$/, "");
        r53.calls.push({ op, input: command.input });
        if (r53.fail) throw r53.fail;
        if (op === "ListHostedZonesByName") {
          // Like AWS: zones sorted by name, starting at DNSName.
          const from = String(command.input.DNSName);
          return { HostedZones: r53.zones.filter((z) => z.Name >= `${from}.`) };
        }
        return {};
      },
      destroy: () => undefined,
    };
  }),
}));

const { candidateZones, publishDkimRecords } = await import("@/lib/aws/route53");

const CREDS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "x".repeat(40), region: "ap-south-1" };

beforeEach(() => {
  r53.zones = [];
  r53.calls = [];
  r53.fail = null;
});

describe("candidateZones", () => {
  it("walks from the domain up to its registrable parent", () => {
    expect(candidateZones("mail.app.example.com")).toEqual([
      "mail.app.example.com",
      "app.example.com",
      "example.com",
    ]);
    expect(candidateZones("example.com")).toEqual(["example.com"]);
  });
});

describe("publishDkimRecords", () => {
  it("upserts the three CNAMEs into the matching public zone", async () => {
    r53.zones = [{ Id: "/hostedzone/Z123", Name: "example.com." }];

    const out = await publishDkimRecords(CREDS, "example.com", ["t1", "t2", "t3"]);

    expect(out).toEqual({ status: "published", zone: "example.com" });
    const change = r53.calls.find((c) => c.op === "ChangeResourceRecordSets")!;
    expect(change.input.HostedZoneId).toBe("Z123");
    expect(change.input.ChangeBatch).toMatchObject({
      Changes: [
        { Action: "UPSERT", ResourceRecordSet: { Name: "t1._domainkey.example.com", Type: "CNAME", ResourceRecords: [{ Value: "t1.dkim.amazonses.com" }] } },
        { Action: "UPSERT", ResourceRecordSet: { Name: "t2._domainkey.example.com" } },
        { Action: "UPSERT", ResourceRecordSet: { Name: "t3._domainkey.example.com" } },
      ],
    });
  });

  it("uses the parent zone for a subdomain", async () => {
    r53.zones = [{ Id: "/hostedzone/Z9", Name: "example.com." }];
    const out = await publishDkimRecords(CREDS, "mail.example.com", ["t1"]);
    expect(out).toEqual({ status: "published", zone: "example.com" });
  });

  it("ignores private zones and near-miss names", async () => {
    r53.zones = [
      { Id: "/hostedzone/ZP", Name: "example.com.", Config: { PrivateZone: true } },
      { Id: "/hostedzone/ZX", Name: "example.com.au." },
    ];
    expect(await publishDkimRecords(CREDS, "example.com", ["t1"])).toEqual({ status: "no_zone" });
    expect(r53.calls.some((c) => c.op === "ChangeResourceRecordSets")).toBe(false);
  });

  it("reports missing permission as denied instead of throwing", async () => {
    r53.fail = Object.assign(new Error("no"), { name: "AccessDenied" });
    expect(await publishDkimRecords(CREDS, "example.com", ["t1"])).toEqual({ status: "denied" });
  });

  it("reports any other AWS error as failed", async () => {
    r53.fail = Object.assign(new Error("slow down"), { name: "Throttling" });
    expect(await publishDkimRecords(CREDS, "example.com", ["t1"])).toEqual({ status: "failed", error: "Throttling" });
  });

  it("does nothing without tokens", async () => {
    expect(await publishDkimRecords(CREDS, "example.com", [])).toEqual({ status: "no_zone" });
    expect(r53.calls).toHaveLength(0);
  });
});
