"use client";

import { useMemo } from "react";
import {
  HEART_RATE_ZONES,
  POWER_ZONES,
  movingOnly,
  zoneBreakdown,
  type ZoneSlice,
} from "@/lib/analysis/zones";

export interface ZonePanelProps {
  watts: Float32Array;
  heartrate?: Float32Array;
  distance: ArrayLike<number>;
  time: ArrayLike<number>;
  paused?: Uint8Array;
  ftp: number;
  /** Lactate threshold heart rate; zero when the rider has not entered one. */
  lthr: number;
  /** True when the file carried real power rather than an estimate. */
  hasMeasuredPower: boolean;
}

/**
 * Where the time actually went.
 *
 * Mean power says a ride averaged 140 W. It does not say whether that was three
 * hours at 140 W or ninety minutes of coffee-shop pace around ten minutes of
 * threshold, and those are different training. This is the chart that
 * distinguishes them.
 */
export function ZonePanel({
  watts,
  heartrate,
  distance,
  time,
  paused,
  ftp,
  lthr,
  hasMeasuredPower,
}: ZonePanelProps) {
  const power = useMemo(
    () => zoneBreakdown(movingOnly(watts, distance, time, paused), ftp, POWER_ZONES, "W"),
    [watts, distance, time, paused, ftp],
  );

  const heart = useMemo(() => {
    if (!heartrate || lthr <= 0) return null;
    return zoneBreakdown(
      movingOnly(heartrate, distance, time, paused),
      lthr,
      HEART_RATE_ZONES,
      "bpm",
    );
  }, [heartrate, distance, time, paused, lthr]);

  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <span className="text-[12px] font-medium text-ink-secondary">Time in zones</span>
        <span className="text-[11px] text-ink-muted">stopped time excluded</span>
      </div>

      <div className="grid gap-x-8 gap-y-6 p-4 md:grid-cols-2">
        <ZoneColumn
          title="Power"
          caption={
            hasMeasuredPower
              ? `against ${Math.round(ftp)} W threshold`
              : `estimated, against ${Math.round(ftp)} W threshold`
          }
          slices={power}
        />
        {heart ? (
          <ZoneColumn title="Heart rate" caption={`against ${lthr} bpm threshold`} slices={heart} />
        ) : (
          <div className="flex flex-col justify-center">
            <div className="text-[12px] font-medium text-ink-secondary">Heart rate</div>
            <p className="mt-2 max-w-prose text-[12px] leading-relaxed text-ink-muted">
              {heartrate
                ? "Set your threshold heart rate in rider settings to see these. Heart rate is measured rather than modelled, so with no power meter it is the more trustworthy half of this panel."
                : "This ride has no heart-rate data."}
            </p>
          </div>
        )}
      </div>

      {hasMeasuredPower ? null : (
        <p className="border-t border-hairline px-4 py-3 text-[11px] leading-relaxed text-ink-muted">
          Power zones inherit the estimate&apos;s error, and the top three depend on
          efforts too short for the model to resolve — treat the shape as
          indicative and the heart-rate column as the measurement.
        </p>
      )}
    </section>
  );
}

function ZoneColumn({
  title,
  caption,
  slices,
}: {
  title: string;
  caption: string;
  slices: ZoneSlice[];
}) {
  // Scale bars against the busiest zone, not against the total. Most rides put
  // 70% of their time in one or two zones, and scaling to the total would
  // flatten every other zone into an invisible sliver.
  const peak = Math.max(...slices.map((s) => s.fraction), 0.0001);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-secondary">{title}</span>
        <span className="text-[11px] text-ink-muted">{caption}</span>
      </div>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {slices.map((s) => (
          <li key={s.index} className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5">
            <span
              className="w-[104px] shrink-0 truncate text-[12px] text-ink-secondary"
              title={`${s.name} — ${s.purpose} · ${s.range}`}
            >
              <span className="text-ink-muted tabular-nums">Z{s.index}</span> {s.name}
            </span>
            <span
              className="h-2.5 overflow-hidden rounded-full bg-surface-3"
              aria-hidden
            >
              <span
                className="block h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${(s.fraction / peak) * 100}%`,
                  background: `var(${s.token})`,
                }}
              />
            </span>
            <span className="w-[86px] shrink-0 text-right text-[12px] tabular-nums text-ink-muted">
              {formatDuration(s.seconds)}
              <span className="ml-1.5 text-ink-muted/70">
                {(s.fraction * 100).toFixed(0)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
