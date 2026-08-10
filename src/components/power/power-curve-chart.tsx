"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import { CURVE_DURATIONS } from "@/lib/analysis/curve";
import "uplot/dist/uPlot.min.css";

/** Durations a rider reasons about, rather than powers of ten. */
const TICKS = [1, 5, 15, 30, 60, 300, 600, 1200, 1800, 3600, 7200, 10800, 18000];

export interface CurveSeries {
  label: string;
  /** CSS custom property holding this series' colour. */
  colorToken: string;
  watts: Float32Array;
  dashed?: boolean;
}

/**
 * Mean-maximal power curve.
 *
 * The x axis is logarithmic because the interesting structure spans five
 * orders of magnitude — a 5-second sprint and a five-hour ride belong on the
 * same chart, and a linear axis would compress everything under a minute into
 * a single pixel column.
 */
export function PowerCurveChart({
  series,
  height = 340,
}: {
  series: CurveSeries[];
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || series.length === 0) return;

    const css = getComputedStyle(host);
    const v = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback;
    const ink = v("--ink-muted", "#888");
    const grid = v("--line-grid", "#222");
    const axis = v("--line-axis", "#333");

    // Drop leading durations no series reaches, so the curve starts where data
    // actually exists rather than at a wall of zeros.
    const firstReal = CURVE_DURATIONS.findIndex((_, i) =>
      series.some((s) => (s.watts[i] ?? 0) > 0),
    );
    const lastReal = (() => {
      for (let i = CURVE_DURATIONS.length - 1; i >= 0; i--) {
        if (series.some((s) => (s.watts[i] ?? 0) > 0)) return i;
      }
      return CURVE_DURATIONS.length - 1;
    })();
    const from = Math.max(0, firstReal);
    const durations = CURVE_DURATIONS.slice(from, lastReal + 1);

    const data: uPlot.AlignedData = [
      durations,
      ...series.map((s) =>
        durations.map((_, i) => {
          const w = s.watts[from + i];
          return w > 0 ? w : null;
        }),
      ),
    ] as uPlot.AlignedData;

    const colors = series.map((s) => v(s.colorToken, "#3987e5"));

    const plot = new uPlot(
      {
        width: host.clientWidth,
        height,
        legend: { show: false },
        padding: [12, 16, 0, 0],
        scales: { x: { time: false, distr: 3 } }, // distr 3 = log10
        axes: [
          {
            stroke: ink,
            grid: { stroke: grid, width: 1 },
            ticks: { stroke: axis, width: 1 },
            font: "11px var(--font-sans, system-ui)",
            size: 30,
            // Explicit ticks at durations a cyclist actually thinks in.
            // uPlot's log scale defaults to decade minor ticks (2,3,…,9 per
            // decade), which at this width collide into an unreadable smear and
            // label nothing anyone cares about.
            splits: () => TICKS.filter((t) => t >= durations[0] && t <= durations.at(-1)!),
            // uPlot's log axis nulls out splits it considers minor before
            // handing them to `values`. Since every tick here was chosen
            // deliberately, keep them all — otherwise half the labels arrive as
            // null and format as "0s".
            filter: (_u, splits) => splits,
            values: (_u, splits) =>
              splits.map((s) => (Number.isFinite(s) ? formatDuration(s) : "")),
          },
          {
            stroke: ink,
            grid: { stroke: grid, width: 1 },
            ticks: { show: false },
            font: "11px var(--font-sans, system-ui)",
            size: 46,
            values: (_u, splits) => splits.map((s) => `${Math.round(s)}`),
          },
        ],
        series: [
          {},
          ...series.map((s, i) => ({
            label: s.label,
            stroke: colors[i],
            width: s.dashed ? 1.5 : 2,
            dash: s.dashed ? [4, 4] : undefined,
            points: { show: false },
          })),
        ],
        hooks: {
          setCursor: [
            (u) => {
              const node = readoutRef.current;
              if (!node) return;
              const i = u.cursor.idx;
              node.innerHTML = "";
              if (i == null) {
                node.append(hint("Hover the curve to read your best effort"));
                return;
              }
              node.append(durationChip(durations[i]));
              series.forEach((s, si) => {
                const w = s.watts[from + i];
                if (w > 0) node.append(chip(s.label, `${Math.round(w)} W`, colors[si]));
              });
            },
          ],
        },
      },
      data,
      host,
    );

    if (readoutRef.current) {
      readoutRef.current.append(hint("Hover the curve to read your best effort"));
    }

    const resize = new ResizeObserver(() =>
      plot.setSize({ width: host.clientWidth, height }),
    );
    resize.observe(host);
    return () => {
      resize.disconnect();
      plot.destroy();
    };
  }, [series, height]);

  return (
    <div>
      <div
        ref={readoutRef}
        className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pb-2 pt-3 text-[12px]"
      />
      <div ref={hostRef} className="w-full" style={{ height }} />
    </div>
  );
}

function chip(label: string, value: string, color: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "flex items-center gap-1.5";
  const dot = document.createElement("span");
  dot.style.cssText = `width:8px;height:8px;border-radius:9999px;background:${color}`;
  const text = document.createElement("span");
  text.style.cssText = "color:var(--ink-secondary)";
  text.textContent = `${label} `;
  const num = document.createElement("strong");
  num.style.cssText = "color:var(--ink);font-variant-numeric:tabular-nums";
  num.textContent = value;
  el.append(dot, text, num);
  return el;
}

function durationChip(seconds: number): HTMLElement {
  const el = document.createElement("span");
  el.style.cssText =
    "color:var(--ink);font-variant-numeric:tabular-nums;font-weight:500";
  el.textContent = formatDuration(seconds);
  return el;
}

function hint(text: string): HTMLElement {
  const el = document.createElement("span");
  el.style.cssText = "color:var(--ink-muted)";
  el.textContent = text;
  return el;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem === 0 ? `${m}m` : `${m}m${String(rem).padStart(2, "0")}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
