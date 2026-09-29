import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AMBER, GREEN } from "@/components/dashboard/badge-tones";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiKeyForm } from "@/components/dashboard/api-key-form";
import { EmptyState, PageHeader, Time } from "@/components/dashboard/primitives";
import { RotateKeyForm } from "@/components/dashboard/rotate-key-form";
import type { SearchParams } from "@/lib/dashboard/params";
import { listApiKeys, type ApiKeySummary } from "@/server/api-keys";
import { getActiveEnvironment } from "@/server/environment";
import { requireTenant } from "@/server/tenant";

import { revokeKey } from "./actions";

export const dynamic = "force-dynamic";

type KeyState = "active" | "expiring" | "expired" | "revoked";

function keyState(key: ApiKeySummary, now: number): KeyState {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && key.expiresAt.getTime() <= now) return "expired";
  if (key.expiresAt) return "expiring";
  return "active";
}

const STATE_STYLE: Record<KeyState, { variant: "outline" | "secondary"; className?: string }> = {
  active: { variant: "secondary", className: GREEN },
  expiring: { variant: "secondary", className: AMBER },
  expired: { variant: "secondary" },
  revoked: { variant: "secondary" },
};

/** SRS §12 API Keys: "Create, revoke, rotate, environment scope". */
export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const environment = await getActiveEnvironment(tenant.id);
  const showInactive = params.inactive === "1";
  const now = Date.now();

  const all = await listApiKeys(tenant.id);
  const inEnv = all.filter((k) => k.environment === environment);
  const usable = inEnv.filter((k) => ["active", "expiring"].includes(keyState(k, now)));
  const shown = showInactive ? inEnv : usable;
  const hiddenCount = inEnv.length - usable.length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="API keys"
        description={
          <>
            Keys are scoped to one environment — a staging key can never send through
            production credentials. Showing <strong className="text-foreground">{environment}</strong>.
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Create a key</CardTitle>
          <CardDescription>
            Production keys start <code>sk_live_</code>, staging keys <code>sk_test_</code>. The
            secret is shown once; only its hash is stored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeyForm defaultEnvironment={environment} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{environment === "production" ? "Production" : "Staging"} keys</CardTitle>
            {hiddenCount > 0 ? (
              <Link
                href={showInactive ? "/dashboard/api-keys" : "/dashboard/api-keys?inactive=1"}
                className="text-muted-foreground text-sm underline underline-offset-4"
              >
                {showInactive ? "Hide" : "Show"} {hiddenCount} revoked or expired
              </Link>
            ) : null}
          </div>
          <CardDescription>
            Rotating issues a replacement and lets the old key keep working for a window
            you choose, so you can deploy the new one without downtime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState title={`No ${environment} keys`}>Create one above to use the API.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Last used</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((key) => {
                  const state = keyState(key, now);
                  const live = state === "active" || state === "expiring";
                  return (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell className="hidden font-mono text-xs sm:table-cell">
                        {key.keyPrefix}…
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-0.5">
                          <Badge variant={STATE_STYLE[state].variant} className={cn(STATE_STYLE[state].className)}>
                            {state}
                          </Badge>
                          {state === "expiring" && key.expiresAt ? (
                            <span className="text-muted-foreground text-xs">
                              stops <Time date={key.expiresAt} />
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs md:table-cell">
                        <Time date={key.lastUsedAt} fallback="never" />
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                        <Time date={key.createdAt} />
                      </TableCell>
                      <TableCell className="text-right whitespace-normal">
                        {live ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            {state === "active" ? <RotateKeyForm keyId={key.id} name={key.name} /> : null}
                            <form action={revokeKey}>
                              <input type="hidden" name="id" value={key.id} />
                              <Button type="submit" variant="ghost" size="sm" className="text-red-700">
                                Revoke
                              </Button>
                            </form>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
