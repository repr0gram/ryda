"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import type { TrainingLoadPoint } from "@/lib/analysis/training-load";
import "uplot/dist/uPlot.min.css";

const DAY = 86_400;

/**
 * Fitness, fatigue and form on one axis.
 *
 * All three are in the same unit (load points), so a single scale is correct —
 * this is deliberately not a dual-axis chart. Form is drawn as a filled band
 * around zero because its sign is the whole message: positive is fresh,
 * negative is buried.
 */
export function TrendChart({
  series,
  height = 300,
}: {
  series: TrainingLoadPoint[];
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
    const fitnessColor = v("--ch-power", "#3987e5");
    const fatigueColor = v("--ch-hr", "#e66767");
    const formColor = v("--ch-wbal", "#c98500");

    const xs = series.map((p) => Date.parse(`${p.date}T00:00:00`) / 1000);
    const data: uPlot.AlignedData = [
      xs,
      series.map((p) => p.fitness),
      series.map((p) => p.fatigue),
      series.map((p) => p.form),
    ];

    const plot = new uPlot(
      {
        width: host.clientWidth,
        height,
        legend: { show: false },
        // Right padding keeps the final date label from clipping at the edge.
        padding: [10, 28, 0, 0],
        scales: { x: { time: true } },
        axes: [
          {
            stroke: ink,
            grid: { stroke: grid, width: 1 },
            ticks: { stroke: axis, width: 1 },
            font: "11px var(--font-sans, system-ui)",
            size: 30,
            // A training calendar is measured in days. Left to its own devices
            // uPlot subdivides a short span into hours, so two days of history
            // renders as "12am, 2am, 4am…" — technically true, and nonsense for
            // this chart. Constrain the ticks to whole days and up.
            incrs: [
              DAY,
              2 * DAY,
              7 * DAY,
              14 * DAY,
              30 * DAY,
              91 * DAY,
              182 * DAY,
              365 * DAY,
            ],
            values: (_u, splits) =>
              splits.map((t) => {
                const d = new Date(t * 1000);
                const span = splits.length > 1 ? splits[1] - splits[0] : DAY;
                return span >= 300 * DAY
                  ? d.toLocaleDateString("en-GB", { year: "numeric" })
                  : span >= 25 * DAY
                    ? d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
                    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
              }),
          },
          {
            stroke: ink,
            grid: { stroke: grid, width: 1 },
            ticks: { show: false },
            font: "11px var(--font-sans, system-ui)",
            size: 40,
          },
        ],
        series: [
          {},
          { label: "Fitness", stroke: fitnessColor, width: 2, points: { show: false } },
          { label: "Fatigue", stroke: fatigueColor, width: 1.5, points: { show: false } },
          {
            label: "Form",
            stroke: formColor,
            width: 1.5,
            fill: withAlpha(formColor, 0.16),
            points: { show: false },
          },
        ],
        hooks: {
          setCursor: [
            (u) => {
              const node = readoutRef.current;
              if (!node) return;
              const i = u.cursor.idx;
              const point = i == null ? series[series.length - 1] : series[i];
              if (!point) return;
              node.innerHTML = "";
              node.append(
                chip("Fitness", point.fitness, fitnessColor),
                chip("Fatigue", point.fatigue, fatigueColor),
                chip("Form", point.form, formColor, true),
                dateChip(point.date),
              );
            },
          ],
        },
      },
      data,
      host,
    );

    // Seed the readout with the latest day so it is never empty.
    const last = series[series.length - 1];
    if (readoutRef.current && last) {
      readoutRef.current.append(
        chip("Fitness", last.fitness, fitnessColor),
        chip("Fatigue", last.fatigue, fatigueColor),
        chip("Form", last.form, formColor, true),
        dateChip(last.date),
      );
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

function chip(label: string, value: number, color: string, signed = false): HTMLElement {
  const el = document.createElement("span");
  el.className = "flex items-center gap-1.5";
  const dot = document.createElement("span");
  dot.style.cssText = `width:8px;height:8px;border-radius:9999px;background:${color}`;
  const text = document.createElement("span");
  text.style.cssText = "color:var(--ink-secondary)";
  const num = document.createElement("strong");
  num.style.cssText = "color:var(--ink);font-variant-numeric:tabular-nums";
  const rounded = Math.round(value);
  num.textContent = signed && rounded > 0 ? `+${rounded}` : String(rounded);
  text.textContent = `${label} `;
  el.append(dot, text, num);
  return el;
}

function dateChip(date: string): HTMLElement {
  const el = document.createElement("span");
  el.style.cssText = "color:var(--ink-muted);margin-left:auto";
  el.textContent = new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return el;
}

function withAlpha(hex: string, alpha: number): string {
  const c = hex.replace("#", "");
  const full =
    c.length === 3
      ? c
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : c;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
