"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface Point {
  label: string; // full label for tooltip/table, e.g. "Fri, 20 Nov"
  tick: string; // short axis label, e.g. "20"
  value: number;
}

/** A clean axis: steps of 1, 2 or 5 × 10^n, about four of them, so every gridline value is exact. */
function niceAxis(v: number): { max: number; ticks: number[] } {
  if (v <= 0) return { max: 1, ticks: [0, 1] };
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw)!;
  const unit = Math.max(1, step); // counts never get fractional gridlines
  const max = Math.ceil(v / unit) * unit;
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += unit) ticks.push(t);
  return { max, ticks };
}

/**
 * One series, one axis. Columns ≤ 24px with a 4px rounded top and a square baseline, hairline grid,
 * per-column hover/focus tooltip, and a table view so values are never colour- or hover-only.
 */
export function ColumnChart({ title, points, format, height = 180 }: { title: string; points: Point[]; format: (n: number) => string; height?: number }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // Draw at the container's real width so text stays 11px on phones instead of scaling down with the SVG.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = { l: 44, r: 8, t: 10, b: 22 };
  const { max, ticks } = niceAxis(Math.max(0, ...points.map((p) => p.value)));
  const plotW = W - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const band = plotW / Math.max(1, points.length);
  const bw = Math.min(24, Math.max(2, band - 2)); // ≥ 2px surface gap between neighbours
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const every = Math.ceil(points.length / Math.max(4, Math.floor(W / 64))); // ~one label per 64px
  const sparse = points.length > 31; // long ranges label month starts only (callers pass "" elsewhere)
  const total = points.reduce((s, p) => s + p.value, 0);
  const peak = points.reduce((b, p, i) => (p.value > (points[b]?.value ?? -1) ? i : b), 0);

  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <button type="button" className="text-xs font-medium text-muted underline" onClick={() => setTable((t) => !t)} aria-controls={id}>
          {table ? "Show chart" : "Show table"}
        </button>
      </figcaption>
      <p className="mt-0.5 text-2xl font-bold tabular-nums">{format(total)}</p>
      <div id={id} ref={box} className="relative mt-2">
        {table ? (
          <div className="max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted"><tr><th className="px-3 py-2 font-semibold">Day</th><th className="px-3 py-2 text-right font-semibold">{title}</th></tr></thead>
              <tbody>{points.map((p) => <tr key={p.label} className="border-t border-line"><td className="px-3 py-1.5">{p.label}</td><td className="px-3 py-1.5 text-right tabular-nums">{format(p.value)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} className="block max-w-full" role="img" aria-label={`${title}: ${format(total)} in total, highest ${format(points[peak]?.value ?? 0)} on ${points[peak]?.label ?? ""}`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular-nums">{format(t)}</text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = pad.l + i * band + (band - bw) / 2;
              const h = Math.max(0, y(0) - y(p.value));
              const r = Math.min(4, bw / 2, h);
              const top = y(0) - h;
              return (
                <g key={p.label} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} role="graphics-symbol" aria-label={`${p.label}: ${format(p.value)}`}>
                  {/* hit target is the whole band, taller than the mark */}
                  <rect x={pad.l + i * band} y={pad.t} width={band} height={plotH} fill="transparent" />
                  {h > 0 && (
                    <path
                      d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z`}
                      fill="var(--chart-1)"
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  )}
                  {p.tick && (sparse || i % every === 0) && <text x={x + bw / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">{p.tick}</text>}
                </g>
              );
            })}
          </svg>
        )}
        {!table && hover !== null && points[hover] && (
          <div
            role="status"
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-card"
            style={{ left: `${Math.min(88, Math.max(12, ((pad.l + hover * band + band / 2) / W) * 100))}%` }}
          >
            <div className="text-muted">{points[hover].label}</div>
            <div className="font-semibold tabular-nums">{format(points[hover].value)}</div>
          </div>
        )}
      </div>
    </figure>
  );
}
