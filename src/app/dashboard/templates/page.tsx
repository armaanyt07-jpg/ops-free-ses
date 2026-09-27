import Link from "next/link";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, PageHeader, Pagination, Time } from "@/components/dashboard/primitives";
import { PAGE_SIZE, parsePage, type SearchParams } from "@/lib/dashboard/params";
import { definitionsOf, listTemplates } from "@/server/templates";
import { requireTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

const PATH = "/dashboard/templates";

/** SRS §12 Templates: "Editor, versions, variables, preview, test send". */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const q = typeof params.q === "string" ? params.q.slice(0, 120) : undefined;
  const includeArchived = params.archived === "1";
  const result = await listTemplates(tenant.id, {
    search: q,
    includeArchived,
    page: parsePage(params),
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates"
        description={
          <>
            Reusable emails with <code>{"{{variables}}"}</code>. Send one with{" "}
            <code>templateId</code> and <code>variables</code> on <code>POST /api/v1/send</code>.
            Templates are shared by staging and production.
          </>
        }
        actions={
          <Button asChild>
            <Link href={`${PATH}/new`}>
              <Plus className="size-4" aria-hidden /> New template
            </Link>
          </Button>
        }
      />

      <form method="get" className="flex flex-wrap items-center gap-3">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search by name" aria-label="Search by name" className="w-full sm:max-w-72" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} />
          Include archived
        </label>
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState title={q ? "No templates match" : "No templates yet"}>
          {q ? null : (
            <Link href={`${PATH}/new`} className="underline underline-offset-4">
              Create your first template
            </Link>
          )}
        </EmptyState>
      ) : (
        <Card className="py-2">
          <CardContent className="px-2 sm:px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Subject</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead className="hidden sm:table-cell">Variables</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((t) => (
                  <TableRow key={t.id} className="relative">
                    <TableCell className="max-w-0 font-medium">
                      <Link href={`${PATH}/${t.id}`} className="block truncate after:absolute after:inset-0 hover:underline">
                        {t.name}
                      </Link>
                      {!t.active ? <Badge variant="secondary" className="mt-1">archived</Badge> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden max-w-0 truncate font-mono text-xs md:table-cell">
                      {t.subject}
                    </TableCell>
                    <TableCell className="tabular-nums">v{t.version}</TableCell>
                    <TableCell className="text-muted-foreground hidden font-mono text-xs sm:table-cell">
                      {definitionsOf(t.variables).map((v) => v.name).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs">
                      <Time date={t.updatedAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Pagination path={PATH} params={params} page={result.page} pageCount={result.pageCount} total={result.total} pageSize={PAGE_SIZE} />
    </div>
  );
}
