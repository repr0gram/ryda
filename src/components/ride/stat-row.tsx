import { energyFor, type RideMetrics } from "@/lib/analysis/metrics";

/**
 * The headline numbers. Every one of these recomputes when a range is selected,
 * so the row always describes exactly what is on screen.
 */
export function StatRow({
  metrics,
  ftp,
  riderKg,
  reportedCalories,
}: {
  metrics: RideMetrics;
  ftp: number;
  riderKg?: number;
  reportedCalories?: number | null;
}) {
  // The device's own figure when the file carried one, otherwise derived from
  // work. The hint says which, because they answer different questions and
  // differ by roughly a factor of two on the same ride.
  const energy = energyFor(reportedCalories, metrics.meanPower, metrics.movingSeconds);
  const stats: { label: string; value: string; unit?: string; hint?: string }[] = [
    {
      label: "Distance",
      value: (metrics.distanceMeters / 1000).toFixed(1),
      unit: "km",
    },
    {
      label: "Climbing",
      value: Math.round(metrics.elevationGainMeters).toLocaleString("en-GB"),
      unit: "m",
    },
    { label: "Moving", value: formatClock(metrics.movingSeconds) },
    {
      label: "Weighted power",
      value: Math.round(metrics.weightedPower).toString(),
      unit: "W",
      hint: "30-second weighted, estimated",
    },
    {
      label: "Intensity",
      value: metrics.intensity.toFixed(2),
      hint: `vs ${ftp} W threshold`,
    },
    {
      label: "Load",
      value: Math.round(metrics.load).toString(),
      hint: "100 = one hour at threshold",
    },
    {
      label: "Energy",
      value: Math.round(energy.calories).toLocaleString("en-GB"),
      unit: "kcal",
      // Kept short: this row truncates hints, and which source it came from is
      // the part that must survive.
      hint: energy.source === "device" ? "from your head unit" : "derived from work",
    },
    riderKg
      ? {
          // W/kg is how cyclists actually compare efforts, and it is the number
          // that makes the mass setting legible.
          label: "Weighted W/kg",
          value: (metrics.weightedPower / riderKg).toFixed(2),
          hint: `at ${riderKg} kg`,
        }
      : {
          label: "Work",
          value: Math.round(metrics.kilojoules).toLocaleString("en-GB"),
          unit: "kJ",
        },
    metrics.decoupling
      ? {
          label: "Decoupling",
          value: `${metrics.decoupling.percent >= 0 ? "" : "−"}${Math.abs(metrics.decoupling.percent).toFixed(1)}`,
          unit: "%",
          hint: metrics.decoupling.percent < 5 ? "well coupled" : "aerobic drift",
        }
      : {
          label: "Efficiency",
          value: metrics.efficiency ? metrics.efficiency.toFixed(2) : "—",
          unit: "W/bpm",
        },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-[var(--line-hairline)] sm:grid-cols-3 lg:grid-cols-9">
      {stats.map((s) => (
        <div key={s.label} className="bg-surface-1 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">
            {s.label}
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="figure-hero text-[22px] text-ink">{s.value}</span>
            {s.unit ? <span className="text-[12px] text-ink-muted">{s.unit}</span> : null}
          </div>
          {s.hint ? (
            <div className="mt-0.5 truncate text-[11px] text-ink-muted">{s.hint}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
