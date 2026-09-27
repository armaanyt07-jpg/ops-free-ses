import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, Time } from "@/components/dashboard/primitives";
import { TemplateEditor } from "@/components/dashboard/template-editor";
import { TemplateTestForm } from "@/components/dashboard/template-test-form";
import type { SearchParams } from "@/lib/dashboard/params";
import { render, sampleValues } from "@/lib/templates/engine";
import { getActiveEnvironment } from "@/server/environment";
import { definitionsOf, getTemplate, listVersions } from "@/server/templates";
import { requireTenant } from "@/server/tenant";

import { restoreTemplateVersion, setTemplateArchived } from "../actions";

export const dynamic = "force-dynamic";

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tenant = await requireTenant();
  const template = await getTemplate(tenant.id, id);
  if (!template) notFound();

  const [versions, environment] = await Promise.all([
    listVersions(tenant.id, template.id),
    getActiveEnvironment(tenant.id),
  ]);

  const definitions = definitionsOf(template.variables);
  const samples = sampleValues(definitions);

  const viewing = Number(query.v);
  const old =
    Number.isInteger(viewing) && viewing !== template.version
      ? versions.find((v) => v.version === viewing)
      : undefined;

  const oldPreview = old
    ? render(
        {
          subject: old.subject,
          html: old.htmlBody,
          text: old.textBody,
          variables: definitionsOf(old.variables),
        },
        Object.fromEntries(
          definitionsOf(old.variables).map((v) => [v.name, v.sample || v.defaultValue || `[${v.name}]`]),
        ),
      )
    : null;

  const apiExample = JSON.stringify(
    {
      from: "you@your-domain.com",
      to: ["success@simulator.amazonses.com"],
      templateId: template.id,
      variables: samples,
    },
    null,
    2,
  );

  return (
    <div className="space-y-6">
      <Link href="/dashboard/templates" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" aria-hidden /> Templates
      </Link>

      <PageHeader
        title={template.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">v{template.version}</Badge>
            {template.active ? null : <Badge variant="secondary">archived</Badge>}
            <span>
              updated <Time date={template.updatedAt} /> ·{" "}
              <code className="text-xs">{template.id}</code>
            </span>
          </span>
        }
        actions={
          <form action={setTemplateArchived}>
            <input type="hidden" name="id" value={template.id} />
            <input type="hidden" name="archived" value={String(template.active)} />
            <Button type="submit" variant="outline" size="sm">
              {template.active ? "Archive" : "Restore from archive"}
            </Button>
          </form>
        }
      />

      {query.created === "1" ? (
        <Alert>
          <AlertDescription>Created as v1. Every save that changes content becomes a new version.</AlertDescription>
        </Alert>
      ) : null}

      {old && oldPreview ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <History className="size-4" aria-hidden /> Viewing v{old.version}
                </CardTitle>
                <CardDescription>
                  Read-only. Saved by {old.createdBy ?? "unknown"} <Time date={old.createdAt} />
                  {old.note ? ` · ${old.note}` : ""}.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <form action={restoreTemplateVersion}>
                  <input type="hidden" name="id" value={template.id} />
                  <input type="hidden" name="version" value={old.version} />
                  <Button type="submit" size="sm">
                    Restore as v{template.version + 1}
                  </Button>
                </form>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/dashboard/templates/${template.id}`}>Back to current</Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              <span className="text-muted-foreground">Subject:</span> {oldPreview.subject}
            </p>
            <iframe title={`Preview of v${old.version}`} sandbox="" srcDoc={oldPreview.html} className="h-96 w-full rounded-md border bg-white" />
            <details>
              <summary className="text-muted-foreground cursor-pointer text-sm">Plain text</summary>
              <pre className="bg-muted mt-2 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{oldPreview.text}</pre>
            </details>
          </CardContent>
        </Card>
      ) : (
        <TemplateEditor
          key={template.version}
          templateId={template.id}
          currentVersion={template.version}
          initial={{
            name: template.name,
            subject: template.subject,
            html: template.htmlBody,
            text: template.textBody ?? "",
            variables: definitions,
          }}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Send a test</CardTitle>
            <CardDescription>Through the real pipeline, from the saved version, in {environment}.</CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateTestForm
              templateId={template.id}
              version={template.version}
              samples={samples}
              environment={environment}
              archived={!template.active}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Versions</CardTitle>
            <CardDescription>Immutable. Restoring an old version saves it as a new one.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead className="hidden sm:table-cell">Saved by</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <span className="font-medium tabular-nums">v{v.version}</span>
                      {v.note ? <span className="text-muted-foreground block text-xs">{v.note}</span> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden max-w-40 truncate text-xs sm:table-cell">
                      {v.createdBy ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      <Time date={v.createdAt} />
                    </TableCell>
                    <TableCell className="text-right">
                      {v.version === template.version ? (
                        <Badge variant="outline">current</Badge>
                      ) : (
                        <Link href={`/dashboard/templates/${template.id}?v=${v.version}`} className="text-sm underline underline-offset-4">
                          View
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Send from your code</CardTitle>
          <CardDescription>
            <code>templateId</code> replaces <code>subject</code>, <code>html</code> and{" "}
            <code>text</code>. Missing required variables, unknown ones, or an archived template
            are refused with 400 and the reasons.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
            {`curl -X POST $OPS_URL/api/v1/send \\
  -H "Authorization: Bearer ${environment === "production" ? "sk_live_…" : "sk_test_…"}" \\
  -H "Content-Type: application/json" \\
  -d '${apiExample}'`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
