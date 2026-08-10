"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import type { CursorStore, Selection } from "@/lib/cursor-store";
import "uplot/dist/uPlot.min.css";

export interface StreamChartProps {
  label: string;
  /** CSS custom property holding this channel's colour, e.g. "--ch-power". */
  colorToken: string;
  /** Shared x axis — elapsed seconds or cumulative metres. */
  x: Float64Array;
  y: Float32Array | Float64Array;
  unit: string;
  height?: number;
  /** Render as a filled area (elevation) rather than a line. */
  fill?: boolean;
  /** Format for the live readout and tooltip. */
  format?: (value: number) => string;
  cursor: CursorStore;
  /** uPlot sync key — every chart sharing it gets a linked crosshair for free. */
  syncKey: string;
  onSelect?: (selection: Selection | null) => void;
  xIsDistance: boolean;
}

function cssVar(name: string, el: HTMLElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function StreamChart({
  label,
  colorToken,
  x,
  y,
  unit,
  height = 96,
  fill = false,
  format = (v) => Math.round(v).toString(),
  cursor,
  syncKey,
  onSelect,
  xIsDistance,
}: StreamChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  // Keep the latest callback without making it a chart-rebuild dependency.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const color = cssVar(colorToken, host) || "#888";
    const ink = cssVar("--ink-muted", host) || "#888";
    const grid = cssVar("--line-grid", host) || "#333";
    const axis = cssVar("--line-axis", host) || "#444";

    const data: uPlot.AlignedData = [
      x as unknown as number[],
      y as unknown as number[],
    ];

    const plot = new uPlot(
      {
        width: host.clientWidth,
        height,
        // The app owns the frame, labels, and readout — uPlot only draws data.
        legend: { show: false },
        padding: [8, 0, 0, 0],
        scales: { x: { time: false } },
        cursor: {
          sync: { key: syncKey },
          x: true,
          y: false,
          points: { show: true, size: 6 },
          drag: { x: true, y: false, setScale: false },
        },
        axes: [
          {
            stroke: ink,
            grid: { stroke: grid, width: 1 },
            ticks: { stroke: axis, width: 1 },
            font: "11px var(--font-sans, system-ui)",
            size: 26,
            values: (_u, splits) =>
              splits.map((v) =>
                xIsDistance ? `${(v / 1000).toFixed(0)}km` : formatClock(v),
              ),
          },
          {
            stroke: ink,
            grid: { stroke: grid, width: 1 },
            ticks: { show: false },
            font: "11px var(--font-sans, system-ui)",
            size: 44,
          },
        ],
        series: [
          {},
          {
            stroke: color,
            width: 2,
            fill: fill ? withAlpha(color, 0.22) : undefined,
            points: { show: false },
          },
        ],
        hooks: {
          setCursor: [
            (u) => {
              cursor.set(u.cursor.idx ?? null);
            },
          ],
          setSelect: [
            (u) => {
              const sel = u.select;
              if (!sel || sel.width <= 2) {
                onSelectRef.current?.(null);
                return;
              }
              const from = u.posToIdx(sel.left);
              const to = u.posToIdx(sel.left + sel.width);
              onSelectRef.current?.({
                from: Math.min(from, to),
                to: Math.max(from, to),
              });
            },
          ],
        },
      },
      data,
      host,
    );

    plotRef.current = plot;

    const resize = new ResizeObserver(() => {
      plot.setSize({ width: host.clientWidth, height });
    });
    resize.observe(host);

    // Live value readout: written straight to the DOM, never through React.
    const unsubscribe = cursor.subscribe((idx) => {
      const node = readoutRef.current;
      if (!node) return;
      if (idx === null || idx < 0 || idx >= y.length) {
        node.textContent = "—";
        return;
      }
      node.textContent = format(y[idx]);
    });

    return () => {
      unsubscribe();
      resize.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [x, y, colorToken, height, fill, cursor, syncKey, format, xIsDistance]);

  return (
    <div className="border-t border-hairline first:border-t-0">
      <div className="flex items-baseline justify-between px-4 pt-3">
        {/* Direct label + swatch: this is the secondary encoding that lets the
            channel palette sit in the CVD floor band legitimately. */}
        <span className="flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ background: `var(${colorToken})` }}
          />
          {label}
        </span>
        <span className="flex items-baseline gap-1 tabular-nums">
          <span ref={readoutRef} className="text-[13px] font-medium text-ink">
            —
          </span>
          <span className="text-[11px] text-ink-muted">{unit}</span>
        </span>
      </div>
      <div ref={hostRef} className="w-full" style={{ height }} />
    </div>
  );
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}m`;
}

/** uPlot wants a concrete colour string, so resolve the token to rgba. */
function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return c;
}
