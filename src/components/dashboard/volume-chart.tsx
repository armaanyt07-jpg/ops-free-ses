"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Message volume by outcome over time — a stacked column per bucket.
 *
 * Built to the dataviz method: categorical slots 1–4 in fixed order, validated
 * against this app's white surface (all hard checks pass; slots 3 and 4 sit
 * below 3:1 contrast, so the legend, per-column tooltip and data table below
 * are the required relief, not decoration). Columns are capped at 24px with a
 * 4px rounded data-end and a square baseline; stacked segments are separated by
 * a 2px surface gap rather than strokes; gridlines are 1px and recessive.
 *
 * Light only: this app has no dark theme to validate against.
 */
export interface VolumePoint {
  /** ISO timestamp of the bucket start (UTC). */
  start: string;
  delivered: number;
  pending: number;
  problems: number;
  notSent: number;
}

const SERIES = [
  { key: "delivered", label: "Delivered", color: "var(--series-1)" },
  { key: "pending", label: "Awaiting outcome", color: "var(--series-2)" },
  { key: "problems", label: "Bounced / complained", color: "var(--series-3)" },
  { key: "notSent", label: "Failed / suppressed", color: "var(--series-4)" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 40 };
const GAP = 2;
const RADIUS = 4;

function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  return { top: Math.ceil(max / step) * step, step };
}

/** A column segment whose top corners are rounded (the data end). */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

const count = new Intl.NumberFormat("en-US");

function label(start: Date, hourly: boolean) {
  return hourly
    ? `${String(start.getUTCHours()).padStart(2, "0")}:00`
    : start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function VolumeChart({ points, hourly }: { points: VolumePoint[]; hourly: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      // No floor above the narrowest real container (~240px on a 320px
      // phone), or the chart would overflow sideways.
      if (entry) setWidth(Math.max(200, Math.floor(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const totals = points.map((p) => p.delivered + p.pending + p.problems + p.notSent);
  const { top, step } = niceScale(Math.max(0, ...totals));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, points.length);
  const barW = Math.max(3, Math.min(24, band * 0.6));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  // Thin the x labels so they never collide: roughly one per 56px.
  const every = Math.max(1, Math.ceil(56 / band));
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const empty = totals.every((t) => t === 0);

  const hovered = hover === null ? null : points[hover];

  return (
    <div
      className="space-y-3"
      style={
        {
          "--series-1": "#2a78d6",
          "--series-2": "#eb6834",
          "--series-3": "#1baf7a",
          "--series-4": "#eda100",
        } as React.CSSProperties
      }
    >
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="text-muted-foreground flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>

      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Message volume by outcome, ${points.length} ${hourly ? "hours" : "days"}. Full values in the table below.`}
          className="block"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "#c3c2b7" : "#ecebe6"}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={PAD.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {count.format(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const x = PAD.left + i * band + (band - barW) / 2;
            let base = 0;
            const stacked = SERIES.filter((s) => p[s.key as SeriesKey] > 0);
            return (
              <g key={p.start} opacity={hover === null || hover === i ? 1 : 0.45}>
                {stacked.map((s, j) => {
                  const v = p[s.key as SeriesKey];
                  const y0 = y(base);
                  const y1 = y(base + v);
                  base += v;
                  // Surface gap between touching segments, never a stroke.
                  const h = Math.max(1, y0 - y1 - (j > 0 ? GAP : 0));
                  const top = y1;
                  const isTop = j === stacked.length - 1;
                  return isTop ? (
                    <path key={s.key} d={roundedTop(x, top, barW, h, RADIUS)} fill={s.color} />
                  ) : (
                    <rect key={s.key} x={x} y={top} width={barW} height={h} fill={s.color} />
                  );
                })}
                {i % every === 0 ? (
                  <text
                    x={PAD.left + i * band + band / 2}
                    y={HEIGHT - 8}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[11px]"
                  >
                    {label(new Date(p.start), hourly)}
                  </text>
                ) : null}
                {/* Hit target: the whole band, far larger than the mark. */}
                <rect
                  x={PAD.left + i * band}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`${label(new Date(p.start), hourly)}: ${totals[i]} messages`}
                />
              </g>
            );
          })}
        </svg>

        {empty ? (
          <p className="text-muted-foreground pointer-events-none absolute inset-0 grid place-items-center text-sm">
            No messages in this window.
          </p>
        ) : null}

        {hovered && hover !== null ? (
          <div
            role="tooltip"
            className="bg-popover text-popover-foreground pointer-events-none absolute top-2 z-10 w-52 rounded-lg border p-3 text-xs shadow-md"
            style={{
              left: Math.min(
                Math.max(0, PAD.left + hover * band + band / 2 - 104),
                width - 208,
              ),
            }}
          >
            <p className="mb-2 font-medium">
              {hourly
                ? new Date(hovered.start).toISOString().slice(0, 13).replace("T", " ") + ":00 UTC"
                : label(new Date(hovered.start), false) + " (UTC)"}
            </p>
            <ul className="space-y-1">
              {SERIES.map((s) => (
                <li key={s.key} className="flex items-center gap-2">
                  <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                  <span className="text-muted-foreground flex-1">{s.label}</span>
                  <span className="tabular-nums">{count.format(hovered[s.key as SeriesKey])}</span>
                </li>
              ))}
              <li className="flex justify-between border-t pt-1 font-medium">
                <span>Total</span>
                <span className="tabular-nums">{count.format(totals[hover] ?? 0)}</span>
              </li>
            </ul>
          </div>
        ) : null}
      </div>

      <details className="text-sm">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
          Show data table
        </summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-background sticky top-0">
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-1.5 pr-3 font-medium">{hourly ? "Hour (UTC)" : "Day (UTC)"}</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1.5 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {points.map((p, i) => (
                <tr key={p.start} className="border-b last:border-0">
                  <td className="py-1 pr-3">
                    {hourly ? new Date(p.start).toISOString().slice(0, 13).replace("T", " ") : p.start.slice(0, 10)}
                  </td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1 pr-3 text-right">
                      {count.format(p[s.key as SeriesKey])}
                    </td>
                  ))}
                  <td className="sr-only">{totals[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
