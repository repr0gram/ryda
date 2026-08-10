"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeTrainingLoad,
  consistency,
  rampRate,
  type DatedLoad,
} from "@/lib/analysis/training-load";
import { listRides, type RideSummary } from "@/lib/store/rides";
import { TrendChart } from "./trend-chart";

const RANGES = [
  { id: "90", label: "90 days", days: 90 },
  { id: "180", label: "6 months", days: 180 },
  { id: "365", label: "1 year", days: 365 },
  { id: "all", label: "All", days: 0 },
];

export function TrendView() {
  const [rides, setRides] = useState<RideSummary[] | null>(null);
  const [rangeId, setRangeId] = useState("180");

  useEffect(() => {
    listRides().then(setRides).catch(() => setRides([]));
  }, []);

  const series = useMemo(() => {
    if (!rides || rides.length === 0) return [];
    const entries: DatedLoad[] = rides.map((r) => ({ date: r.localDate, load: r.load }));

    // Always build the curve from the first ride, then window the view. Starting
    // the calculation at the window edge would restart fitness from zero and
    // show a fake ramp.
    const full = computeTrainingLoad(entries, { to: today() });
    const range = RANGES.find((r) => r.id === rangeId)!;
    return range.days === 0 ? full : full.slice(-range.days);
  }, [rides, rangeId]);

  if (rides === null) {
    return <Shell><p className="text-[13px] text-ink-muted">Loading your rides…</p></Shell>;
  }

  if (rides.length === 0) {
    return (
      <Shell>
        <p className="max-w-prose text-[13px] leading-relaxed text-ink-secondary">
          No rides saved yet. Import some from the library and this becomes a picture
          of whether you are actually getting fitter — fitness rising, fatigue
          spiking after hard weeks, form going positive when you back off.
        </p>
      </Shell>
    );
  }

  const latest = series[series.length - 1];
  const ramp = rampRate(series);
  const active = consistency(series, 28);

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink">Trend</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {rides.length} ride{rides.length === 1 ? "" : "s"} · fitness is a 42-day
            average of load, fatigue a 7-day one
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-hairline bg-surface-2 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRangeId(r.id)}
              aria-pressed={rangeId === r.id}
              className={[
                "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                rangeId === r.id
                  ? "bg-surface-1 text-ink shadow-[var(--shadow-card)]"
                  : "text-ink-muted hover:text-ink-secondary",
              ].join(" ")}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-[var(--line-hairline)] sm:grid-cols-4">
        <Stat label="Fitness" value={Math.round(latest?.fitness ?? 0)} hint="42-day load" />
        <Stat label="Fatigue" value={Math.round(latest?.fatigue ?? 0)} hint="7-day load" />
        <Stat
          label="Form"
          value={Math.round(latest?.form ?? 0)}
          signed
          hint={formHint(latest?.form ?? 0)}
        />
        <Stat
          label="Ramp"
          value={Math.round(ramp * 10) / 10}
          signed
          hint={
            ramp > 8
              ? "climbing fast — injury risk"
              : ramp > 0
                ? "building"
                : "easing off"
          }
        />
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-hairline bg-surface-1">
        <TrendChart series={series} />
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">
        {Math.round(active * 100)}% of the last 28 days had a ride on them. Form is
        read before the day&apos;s ride is counted — today&apos;s effort has made you
        tired but not yet fitter, and reading it the other way makes every hard day
        look like a taper.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1100px] px-6 py-8">{children}</div>;
}

function Stat({
  label,
  value,
  hint,
  signed = false,
}: {
  label: string;
  value: number;
  hint?: string;
  signed?: boolean;
}) {
  return (
    <div className="bg-surface-1 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="figure-hero mt-1 text-[22px] text-ink">
        {signed && value > 0 ? `+${value}` : value}
      </div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-ink-muted">{hint}</div> : null}
    </div>
  );
}

function formHint(form: number): string {
  if (form > 15) return "fresh — ready to race";
  if (form > 0) return "rested";
  if (form > -20) return "training productively";
  return "deep in it";
}

function today(): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
