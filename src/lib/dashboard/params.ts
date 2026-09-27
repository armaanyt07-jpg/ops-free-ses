import { emailStatusEnum, type EmailStatus } from "@/db/schema";

/**
 * Dashboard URL state — Phase 4 search, filtering and pagination.
 *
 * Filters live in the query string, not in component state, so every filtered
 * view is a URL: it survives reload, can be bookmarked, and can be pasted to a
 * teammate. These parsers are forgiving on purpose — a hand-edited or stale URL
 * degrades to "no filter", never to an error page.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 25;

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

export function parsePage(params: SearchParams): number {
  const n = Number.parseInt(first(params.page) ?? "1", 10);
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export const WINDOWS = [1, 7, 30] as const;
export type WindowDays = (typeof WINDOWS)[number];

/** SRS §12 Overview: "1/7/30-day metrics". Defaults to 7. */
export function parseWindow(params: SearchParams): WindowDays {
  const n = Number(first(params.window));
  return (WINDOWS as readonly number[]).includes(n) ? (n as WindowDays) : 7;
}

export interface ActivityFilters {
  q?: string | undefined;
  status?: EmailStatus | undefined;
  errorCode?: string | undefined;
  templateId?: string | undefined;
  /** Inclusive, UTC day start. */
  from?: Date | undefined;
  /** Inclusive, UTC day end. */
  to?: Date | undefined;
}

function parseDay(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseActivityFilters(params: SearchParams): ActivityFilters {
  const status = first(params.status);
  const q = first(params.q);
  const errorCode = first(params.error);

  return {
    q: q?.slice(0, 200),
    status: (emailStatusEnum.enumValues as readonly string[]).includes(status ?? "")
      ? (status as EmailStatus)
      : undefined,
    errorCode: errorCode?.slice(0, 120),
    templateId: UUID.test(first(params.template) ?? "") ? first(params.template)!.toLowerCase() : undefined,
    from: parseDay(first(params.from), false),
    to: parseDay(first(params.to), true),
  };
}

/** `YYYY-MM-DD` for a date input's value. */
export function dayValue(date: Date | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/**
 * Builds a link to `path` with the current params plus `changes`. A change of
 * `undefined` removes the key. Changing any filter resets to page 1, because
 * page 7 of the old result set means nothing in the new one.
 */
export function hrefWith(
  path: string,
  params: SearchParams,
  changes: Record<string, string | number | undefined>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const v = first(value);
    if (v !== undefined) next.set(key, v);
  }

  const filterChanged = Object.keys(changes).some((k) => k !== "page");
  if (filterChanged) next.delete("page");

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  if (next.get("page") === "1") next.delete("page");

  const query = next.toString();
  return query ? `${path}?${query}` : path;
}

/** Escapes LIKE metacharacters so user input matches literally. */
export function likePattern(term: string): string {
  return `%${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
