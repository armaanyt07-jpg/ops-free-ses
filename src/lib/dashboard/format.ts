/**
 * Display formatting for the dashboard. Pure and locale-fixed (en-US, UTC), so
 * server and client render identical strings and nothing shifts on hydration.
 */
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const whole = new Intl.NumberFormat("en-US");

/** 1,284 · 12.9K · 4.2M — stat tiles. Exact below 10,000. */
export function formatCount(n: number): string {
  return n < 10_000 ? whole.format(n) : compact.format(n);
}

/** 0.0493 → "4.93%"; small rates keep precision (complaints live near 0.1%). */
export function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  const pct = rate * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return `${pct.toFixed(2)}%`;
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/** "2026-09-27 06:27:33 UTC" — unambiguous, sortable, no locale surprises. */
export function formatDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** "just now", "5m ago", "3h ago", "2d ago", "in 23h"; beyond 30d, the date. */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;

  let text: string;
  if (s < 45) return future ? "in a moment" : "just now";
  if (s < 3600) text = `${Math.round(s / 60)}m`;
  else if (s < 86_400) text = `${Math.round(s / 3600)}h`;
  else if (s < 30 * 86_400) text = `${Math.round(s / 86_400)}d`;
  else return date.toISOString().slice(0, 10);

  return future ? `in ${text}` : `${text} ago`;
}

/** "320 ms", "4.2 s", "3 min" — durations such as webhook lag. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
