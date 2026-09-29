import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AMBER, GREEN } from "@/components/dashboard/badge-tones";
import type { Environment } from "@/db/schema";
import { formatDateTime, formatRelative } from "@/lib/dashboard/format";
import { hrefWith, type SearchParams } from "@/lib/dashboard/params";
import { cn } from "@/lib/utils";

/**
 * Small server components shared by every dashboard page, so headings, times,
 * stat tiles and pagination look and behave the same everywhere.
 */

/**
 * The single, unambiguous environment indicator. Every place that shows the
 * active environment (nav, page headers) should use this rather than its own
 * ad-hoc badge, so "which environment am I looking at" never has two answers.
 */
export function EnvironmentBadge({ environment }: { environment: Environment }) {
  return (
    <Badge
      data-testid="environment-badge"
      variant="secondary"
      className={cn(
        "font-semibold tracking-wide uppercase",
        environment === "production" ? GREEN : AMBER,
      )}
    >
      {environment}
    </Badge>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Relative time, with the exact UTC timestamp on hover. */
export function Time({ date, fallback = "—" }: { date: Date | null | undefined; fallback?: string }) {
  if (!date) return <span className="text-muted-foreground">{fallback}</span>;
  return (
    <time dateTime={date.toISOString()} title={formatDateTime(date)} className="whitespace-nowrap">
      {formatRelative(date)}
    </time>
  );
}

export function StatTile({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <Card className="h-full gap-1.5 py-4 transition-colors hover:border-primary/30 hover:shadow-sm">
      <CardHeader className="px-4">
        <CardDescription className="text-xs font-medium tracking-wide uppercase">
          {label}
        </CardDescription>
        <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      {hint ? <CardContent className="text-muted-foreground px-4 text-xs">{hint}</CardContent> : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-2 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="text-muted-foreground mt-1 text-sm">{children}</div> : null}
    </div>
  );
}

/** Segmented links, e.g. the 1/7/30-day window. The URL is the state. */
export function SegmentedLinks({
  path,
  params,
  paramKey,
  options,
  current,
}: {
  path: string;
  params: SearchParams;
  paramKey: string;
  options: Array<{ value: string; label: string }>;
  current: string;
}) {
  return (
    <nav aria-label={paramKey} className="bg-muted inline-flex rounded-lg p-0.5 text-sm">
      {options.map((o) => {
        const active = o.value === current;
        return (
          <Link
            key={o.value}
            href={hrefWith(path, params, { [paramKey]: o.value })}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "bg-background rounded-md px-3 py-1 font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground rounded-md px-3 py-1"
            }
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Pagination({
  path,
  params,
  page,
  pageCount,
  total,
  pageSize,
}: {
  path: string;
  params: SearchParams;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}) {
  if (total === 0) return null;
  const firstRow = (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  const linkClass =
    "rounded-md border px-3 py-1.5 text-sm hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-40";

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col items-center justify-between gap-3 pt-4 text-sm sm:flex-row"
    >
      <p className="text-muted-foreground">
        {firstRow.toLocaleString("en-US")}–{lastRow.toLocaleString("en-US")} of{" "}
        {total.toLocaleString("en-US")}
      </p>
      <div className="flex items-center gap-2">
        <Link
          href={hrefWith(path, params, { page: page - 1 })}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={linkClass}
        >
          Previous
        </Link>
        <span className="text-muted-foreground tabular-nums">
          Page {page} of {pageCount}
        </span>
        <Link
          href={hrefWith(path, params, { page: page + 1 })}
          aria-disabled={page >= pageCount}
          tabIndex={page >= pageCount ? -1 : undefined}
          className={linkClass}
        >
          Next
        </Link>
      </div>
    </nav>
  );
}

/** A label/value list for detail pages. */
export function Fields({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
