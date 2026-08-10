"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CURVE_DURATIONS,
  estimateFtp,
  fitCriticalPower,
  powerAt,
  type PowerCurve,
} from "@/lib/analysis/curve";
import { elementwiseMax } from "@/lib/analysis/signal";
import { listCurves, type DatedCurve } from "@/lib/store/rides";
import { DEFAULT_SETTINGS, loadSettings, type RiderSettings } from "@/lib/rider-settings";
import { PowerCurveChart, formatDuration, type CurveSeries } from "./power-curve-chart";

/** Durations worth calling out as headline efforts. */
const HIGHLIGHTS = [5, 60, 300, 1200, 3600];

export function PowerView() {
  const [curves, setCurves] = useState<DatedCurve[] | null>(null);
  const [settings, setSettings] = useState<RiderSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(loadSettings());
    listCurves()
      .then(setCurves)
      .catch(() => setCurves([]));
  }, []);

  const { allTime, recent } = useMemo(() => {
    if (!curves || curves.length === 0) return { allTime: null, recent: null };
    const cutoff = daysAgo(90);
    return {
      allTime: envelope(curves),
      recent: envelope(curves.filter((c) => c.localDate >= cutoff)),
    };
  }, [curves]);

  if (curves === null) {
    return <Shell><p className="text-[13px] text-ink-muted">Loading…</p></Shell>;
  }

  if (!allTime) {
    return (
      <Shell>
        <h1 className="text-xl font-medium tracking-tight text-ink">Power</h1>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-secondary">
          Import some rides and this becomes your power-duration curve — the best
          you have ever held for every duration from five seconds to five hours,
          with the last 90 days drawn against your all-time best so you can see
          which part of the curve is actually moving.
        </p>
      </Shell>
    );
  }

  const series: CurveSeries[] = [
    { label: "All time", colorToken: "--ch-power", watts: allTime.watts, dashed: true },
  ];
  if (recent) {
    series.unshift({ label: "Last 90 days", colorToken: "--ch-hr", watts: recent.watts });
  }

  const ftp = estimateFtp(allTime);
  const cp = fitCriticalPower(allTime);
  const mass = settings.configured ? settings.riderKg : null;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3 pb-5">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink">Power</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Best mean power for every duration, across {curves.length} ride
            {curves.length === 1 ? "" : "s"} · estimated, not measured
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-[var(--line-hairline)] sm:grid-cols-3 lg:grid-cols-5">
        {HIGHLIGHTS.map((d) => {
          const w = powerAt(allTime, d);
          return (
            <div key={d} className="bg-surface-1 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-muted">
                {formatDuration(d)}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="figure-hero text-[22px] text-ink">
                  {w > 0 ? Math.round(w) : "—"}
                </span>
                <span className="text-[12px] text-ink-muted">W</span>
              </div>
              {mass && w > 0 ? (
                <div className="mt-0.5 text-[11px] text-ink-muted">
                  {(w / mass).toFixed(2)} W/kg
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-hairline bg-surface-1">
        <div className="flex flex-wrap items-center gap-4 border-b border-hairline px-4 py-3">
          <span className="text-[12px] font-medium text-ink-secondary">
            Power–duration curve
          </span>
          <div className="flex items-center gap-4">
            {series.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5 text-[12px]">
                <span
                  aria-hidden
                  className="h-0.5 w-4 rounded-full"
                  style={{
                    background: `var(${s.colorToken})`,
                    opacity: s.dashed ? 0.6 : 1,
                  }}
                />
                <span className="text-ink-muted">{s.label}</span>
              </span>
            ))}
          </div>
        </div>
        <PowerCurveChart series={series} />
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card title="Threshold estimate">
          {ftp ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="figure-hero text-[32px] text-ink">
                  {Math.round(ftp.watts)}
                </span>
                <span className="text-[13px] text-ink-muted">W</span>
                {mass ? (
                  <span className="ml-2 text-[13px] text-ink-secondary">
                    {(ftp.watts / mass).toFixed(2)} W/kg
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
                {ftp.note}
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                Your settings currently use {settings.ftp} W for Intensity and Load.
                {Math.abs(settings.ftp - ftp.watts) > 15
                  ? " Those disagree — worth reconciling."
                  : ""}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-ink-muted">Not enough data yet.</p>
          )}
        </Card>

        <Card title="Critical power">
          {cp ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="figure-hero text-[32px] text-ink">
                    {Math.round(cp.cp)}
                  </span>
                  <span className="text-[13px] text-ink-muted">W</span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="figure-hero text-[20px] text-ink">
                    {(cp.wPrime / 1000).toFixed(1)}
                  </span>
                  <span className="text-[13px] text-ink-muted">kJ above CP (W′)</span>
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
                Fitted across {cp.points} efforts between two and fifteen minutes
                (R² {cp.r2.toFixed(2)}). Critical power is a physiological
                boundary, unlike threshold, which is defined by an arbitrary hour.
              </p>
              {cp.r2 < 0.9 ? (
                <p
                  className="mt-2 text-[12px] leading-relaxed"
                  style={{ color: "var(--status-warning)" }}
                >
                  The fit is loose, which usually means you have not gone deep
                  enough at these durations for the model to have anything to
                  work with.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[13px] text-ink-muted">
              Needs several hard efforts between two and fifteen minutes.
            </p>
          )}
        </Card>
      </div>

      <div className="mt-4 space-y-2 text-[12px] leading-relaxed text-ink-muted">
        <p>
          Every number here comes from modelled power, so it inherits that
          model&apos;s error — roughly ±30–40 W at best, and worse in wind or a bunch.
          The shape of the curve and how it moves over time are far more trustworthy
          than any single value on it.
        </p>
        <p>
          <span className="text-ink-secondary">
            Treat anything under a minute with real suspicion.
          </span>{" "}
          Short efforts are dominated by the acceleration term, which is
          differentiated GPS speed — the noisiest input in the whole model. Without a
          power meter, a five-second number is closer to a guess than a measurement.
          The long end of the curve, where speed is steady, is where this model is
          actually good.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1100px] px-6 py-8">{children}</div>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-hairline bg-surface-1 p-5">
      <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Element-wise max across cached curves — never a re-scan of raw samples. */
function envelope(curves: DatedCurve[]): PowerCurve | null {
  if (curves.length === 0) return null;
  let watts = curves[0].watts;
  for (let i = 1; i < curves.length; i++) {
    watts = elementwiseMax(watts, curves[i].watts);
  }
  return {
    durations: Int32Array.from(CURVE_DURATIONS),
    watts,
    offsets: new Int32Array(watts.length).fill(-1),
  };
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
