import "server-only";

import { and, asc, count, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import {
  emailTemplates,
  emailTemplateVersions,
  type EmailTemplate,
  type EmailTemplateVersion,
} from "@/db/schema";
import { likePattern } from "@/lib/dashboard/params";
import {
  hasErrors,
  MAX_SUBJECT_LENGTH,
  render,
  resolveVariables,
  validateTemplate,
  VARIABLE_NAME,
  type Issue,
  type RenderedEmail,
  type TemplateSource,
  type VariableDefinition,
} from "@/lib/templates/engine";

/**
 * Template storage — SRS FR-6.
 *
 * `email_templates` holds each template's *current* content; every save that
 * changes content appends an immutable row to `email_template_versions` and
 * bumps `version`, in one transaction. Nothing is ever edited in place, so a
 * log's `(template_id, template_version)` always identifies exactly what was
 * rendered.
 *
 * A template is validated on every save (`validateTemplate`); one with errors
 * is never stored. Every read and write is scoped by `userId`.
 */
export class TemplateError extends Error {
  readonly issues: Issue[];
  constructor(message: string, issues: Issue[] = []) {
    super(message);
    this.name = "TemplateError";
    this.issues = issues;
  }
}

const variableSchema = z.object({
  name: z.string().trim().regex(VARIABLE_NAME, "Invalid variable name"),
  required: z.boolean(),
  defaultValue: z.string().optional(),
  sample: z.string().optional(),
  description: z.string().max(200).optional(),
});

export const variablesSchema = z.array(variableSchema).max(50);

/** Reads stored definitions defensively: bad rows become an empty list. */
export function definitionsOf(value: unknown): VariableDefinition[] {
  const parsed = variablesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export interface TemplateContent {
  name: string;
  subject: string;
  html: string;
  text: string | null;
  variables: VariableDefinition[];
}

function sourceOf(c: Pick<TemplateContent, "subject" | "html" | "text" | "variables">): TemplateSource {
  return { subject: c.subject, html: c.html, text: c.text, variables: c.variables };
}

function checkName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) {
    throw new TemplateError("Name is required, at most 120 characters.");
  }
  return trimmed;
}

function validateOrThrow(content: TemplateContent): void {
  const issues = validateTemplate(sourceOf(content));
  if (hasErrors(issues)) throw new TemplateError("The template has errors.", issues);
}

function sameContent(a: EmailTemplate, b: TemplateContent): boolean {
  return (
    a.subject === b.subject &&
    a.htmlBody === b.html &&
    (a.textBody ?? null) === (b.text ?? null) &&
    JSON.stringify(definitionsOf(a.variables)) === JSON.stringify(b.variables)
  );
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function createTemplate(
  userId: string,
  actor: string,
  content: TemplateContent,
): Promise<EmailTemplate> {
  const name = checkName(content.name);
  validateOrThrow(content);

  try {
    return await getDb().transaction(async (tx) => {
      const [row] = await tx
        .insert(emailTemplates)
        .values({
          userId,
          name,
          subject: content.subject,
          htmlBody: content.html,
          textBody: content.text,
          variables: content.variables,
          version: 1,
          active: true,
        })
        .returning();
      if (!row) throw new Error("Failed to create template");

      await tx.insert(emailTemplateVersions).values({
        templateId: row.id,
        userId,
        version: 1,
        subject: row.subject,
        htmlBody: row.htmlBody,
        textBody: row.textBody,
        variables: content.variables,
        createdBy: actor,
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TemplateError(`A template named “${name}” already exists.`);
    }
    throw error;
  }
}

/**
 * Saves content as a new version. A save that changes nothing (same content,
 * same name) creates no version; a rename alone does not either — the name is
 * how people find a template, not part of what gets sent.
 */
export async function updateTemplate(
  userId: string,
  actor: string,
  templateId: string,
  content: TemplateContent,
  note?: string,
): Promise<{ template: EmailTemplate; newVersion: boolean }> {
  const name = checkName(content.name);
  validateOrThrow(content);

  try {
    return await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(emailTemplates)
        .where(and(eq(emailTemplates.id, templateId), eq(emailTemplates.userId, userId)))
        .limit(1)
        .for("update");
      if (!current) throw new TemplateError("Template not found.");

      if (sameContent(current, content)) {
        if (current.name === name) return { template: current, newVersion: false };
        const [renamed] = await tx
          .update(emailTemplates)
          .set({ name, updatedAt: new Date() })
          .where(eq(emailTemplates.id, current.id))
          .returning();
        return { template: renamed!, newVersion: false };
      }

      const version = current.version + 1;
      const [row] = await tx
        .update(emailTemplates)
        .set({
          name,
          subject: content.subject,
          htmlBody: content.html,
          textBody: content.text,
          variables: content.variables,
          version,
          updatedAt: new Date(),
        })
        .where(eq(emailTemplates.id, current.id))
        .returning();

      await tx.insert(emailTemplateVersions).values({
        templateId: current.id,
        userId,
        version,
        subject: content.subject,
        htmlBody: content.html,
        textBody: content.text,
        variables: content.variables,
        createdBy: actor,
        note: note?.slice(0, 200) ?? null,
      });

      return { template: row!, newVersion: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TemplateError(`A template named “${name}” already exists.`);
    }
    throw error;
  }
}

/** Restoring appends: v(n+1) gets v(k)'s content. History is never rewritten. */
export async function restoreVersion(
  userId: string,
  actor: string,
  templateId: string,
  version: number,
): Promise<EmailTemplate> {
  const [template, old] = await Promise.all([
    getTemplate(userId, templateId),
    getVersion(userId, templateId, version),
  ]);
  if (!template || !old) throw new TemplateError("That version does not exist.");

  const { template: row, newVersion } = await updateTemplate(
    userId,
    actor,
    templateId,
    {
      name: template.name,
      subject: old.subject,
      html: old.htmlBody,
      text: old.textBody,
      variables: definitionsOf(old.variables),
    },
    `Restored from v${version}`,
  );
  if (!newVersion) throw new TemplateError(`v${version} is already the current content.`);
  return row;
}

/** Archiving stops a template being sent; its versions and history remain. */
export async function setTemplateActive(
  userId: string,
  templateId: string,
  active: boolean,
): Promise<boolean> {
  const rows = await getDb()
    .update(emailTemplates)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(emailTemplates.id, templateId), eq(emailTemplates.userId, userId)))
    .returning({ id: emailTemplates.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getTemplate(userId: string, templateId: string): Promise<EmailTemplate | null> {
  if (!/^[0-9a-f-]{36}$/i.test(templateId)) return null;
  const [row] = await getDb()
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, templateId), eq(emailTemplates.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function listVersions(userId: string, templateId: string): Promise<EmailTemplateVersion[]> {
  return getDb()
    .select()
    .from(emailTemplateVersions)
    .where(and(eq(emailTemplateVersions.templateId, templateId), eq(emailTemplateVersions.userId, userId)))
    .orderBy(desc(emailTemplateVersions.version));
}

export async function getVersion(
  userId: string,
  templateId: string,
  version: number,
): Promise<EmailTemplateVersion | null> {
  const [row] = await getDb()
    .select()
    .from(emailTemplateVersions)
    .where(
      and(
        eq(emailTemplateVersions.templateId, templateId),
        eq(emailTemplateVersions.userId, userId),
        eq(emailTemplateVersions.version, version),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface TemplateListPage {
  rows: EmailTemplate[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listTemplates(
  userId: string,
  { search, includeArchived = false, page = 1, pageSize = 25 }: {
    search?: string | undefined;
    includeArchived?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<TemplateListPage> {
  const filters = [eq(emailTemplates.userId, userId)];
  if (!includeArchived) filters.push(eq(emailTemplates.active, true));
  if (search?.trim()) filters.push(ilike(emailTemplates.name, likePattern(search.trim())));
  const where = and(...filters);

  const db = getDb();
  const [rows, [totals]] = await Promise.all([
    db.select().from(emailTemplates).where(where).orderBy(asc(emailTemplates.name)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(emailTemplates).where(where),
  ]);
  const total = Number(totals?.n ?? 0);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type ResolvedTemplate =
  | {
      ok: true;
      templateId: string;
      version: number;
      rendered: RenderedEmail;
    }
  | { ok: false; reason: "not_found" | "archived"; message: string }
  | { ok: false; reason: "invalid_variables"; message: string; errors: string[] };

/**
 * Resolves and renders a template for a send — SRS §8 step 3, "Resolve and
 * render template", which happens *before* the log is written. So a bad
 * request is refused with the reasons, rather than accepted and failed later.
 *
 * Another tenant's template id is indistinguishable from a missing one.
 */
export async function renderTemplateForSend(
  userId: string,
  templateId: string,
  variables: Record<string, unknown> | undefined,
): Promise<ResolvedTemplate> {
  const template = await getTemplate(userId, templateId);
  if (!template) {
    return { ok: false, reason: "not_found", message: "No template with that id exists in this account." };
  }
  if (!template.active) {
    return { ok: false, reason: "archived", message: `Template “${template.name}” is archived and cannot be sent.` };
  }

  const definitions = definitionsOf(template.variables);
  const resolved = resolveVariables(definitions, variables);
  if (resolved.errors.length > 0) {
    return {
      ok: false,
      reason: "invalid_variables",
      message: "The template variables are invalid.",
      errors: resolved.errors,
    };
  }

  const rendered = render(
    { subject: template.subject, html: template.htmlBody, text: template.textBody, variables: definitions },
    resolved.values,
  );

  // A valid template can still render an unusable subject once real values
  // are in — empty, or past the header limit. Refuse here rather than let SES
  // reject it in the worker.
  if (!rendered.subject) {
    return { ok: false, reason: "invalid_variables", message: "The template variables are invalid.", errors: ["The rendered subject is empty."] };
  }
  if (rendered.subject.length > MAX_SUBJECT_LENGTH) {
    return {
      ok: false,
      reason: "invalid_variables",
      message: "The template variables are invalid.",
      errors: [`The rendered subject is longer than ${MAX_SUBJECT_LENGTH} characters.`],
    };
  }

  return { ok: true, templateId: template.id, version: template.version, rendered };
}
