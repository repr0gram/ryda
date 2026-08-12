/**
 * Cross-check Ryda's power estimate against Strava's, ride by ride.
 *
 * With no power meter there is no ground truth, only two independent estimators
 * that can be made to disagree in informative ways. Strava's estimate is not
 * correct — it has no cadence channel, so it cannot tell pedalling from
 * freewheeling — but it is derived from the same files by different code, so a
 * systematic ratio between the two is diagnostic in a way a single number is not.
 *
 * Reads a Strava bulk export directory:
 *
 *   npm run audit:power -- ~/Downloads/export_1204807115
 *
 * `Average Watts` in activities.csv is Strava's estimate whenever `Power Count`
 * is 0; a non-zero count means a real meter was present and the column is
 * measured truth, which the report flags separately.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "linkedom";
import { estimatePower } from "@/lib/analysis/power";
import { computeRideMetrics } from "@/lib/analysis/metrics";
import { isCycling } from "@/lib/ingest/sport";
import { toProfile, DEFAULT_SETTINGS, type RiderSettings } from "@/lib/rider-settings";
import { parseFile } from "@/lib/store/import";
import { windFromCsv, headwindSeries } from "@/lib/analysis/wind";

// The ingest layer parses XML with the browser's DOMParser. linkedom provides
// the same interface in Node, which is also how the GPX tests run.
(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

interface StravaRow {
  name: string;
  type: string;
  file: string;
  distanceM: number;
  movingS: number;
  elevationM: number;
  avgHr: number;
  relativeEffort: number;
  /** Strava's own watts — estimated when powerCount is 0, measured otherwise. */
  avgWatts: number;
  powerCount: number;
  windSpeedMs: number | null;
  windBearingDeg: number | null;
  temperatureC: number | null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function readActivities(exportDir: string): StravaRow[] {
  const rows = parseCsv(readFileSync(join(exportDir, "activities.csv"), "utf8"));
  const head = rows[0];
  // Several column names appear twice — a summary block then a detail block.
  // The detail block is the one with real precision, so those take lastIndexOf.
  const first = (n: string) => head.indexOf(n);
  const last = (n: string) => head.lastIndexOf(n);
  const num = (v: string | undefined) => {
    const x = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(x) ? x : null;
  };
  return rows
    .slice(1)
    .filter((r) => r.length > 20)
    .map((r) => ({
      name: r[first("Activity Name")],
      type: r[first("Activity Type")],
      file: r[first("Filename")],
      distanceM: num(r[last("Distance")]) ?? 0,
      movingS: num(r[first("Moving Time")]) ?? 0,
      elevationM: num(r[first("Elevation Gain")]) ?? 0,
      avgHr: num(r[first("Average Heart Rate")]) ?? 0,
      relativeEffort: num(r[last("Relative Effort")]) ?? 0,
      avgWatts: num(r[first("Average Watts")]) ?? 0,
      powerCount: num(r[first("Power Count")]) ?? 0,
      windSpeedMs: num(r[first("Wind Speed")]),
      windBearingDeg: num(r[first("Wind Bearing")]),
      temperatureC: num(r[first("Weather Temperature")]),
    }))
    .filter((r) => r.file && isCycling(r.type));
}

interface Comparison {
  name: string;
  distanceKm: number;
  hours: number;
  strava: number;
  measured: boolean;
  still: number;
  windAware: number;
  weighted: number;
  /** Watts the acceleration term adds to the mean. Should be small. */
  kinetic: number;
  relativeEffort: number;
  load: number;
  avgHr: number;
  /** How the file recorded the inputs the estimate is most sensitive to. */
  speedSource: string;
  altitudeSource: string;
  hasCadence: boolean;
}

async function compare(exportDir: string, settings: RiderSettings): Promise<Comparison[]> {
  const profile = toProfile(settings);
  const out: Comparison[] = [];

  for (const row of readActivities(exportDir)) {
    const path = join(exportDir, row.file);
    if (!existsSync(path)) {
      console.error(`  missing: ${row.file}`);
      continue;
    }
    const buffer = readFileSync(path);
    const file = new File([new Uint8Array(buffer)], row.file.split("/").pop() ?? row.file);

    let ride;
    try {
      ride = await parseFile(file);
    } catch (e) {
      console.error(`  unreadable: ${row.name} — ${(e as Error).message}`);
      continue;
    }

    const wind = windFromCsv(row.windSpeedMs, row.windBearingDeg);
    const headwind = (wind ? headwindSeries(ride.streams, wind) : null) ?? undefined;

    const run = (options: Parameters<typeof estimatePower>[3] = {}) => {
      const { watts } = estimatePower(ride.streams, ride.meta, profile, options);
      return computeRideMetrics({
        watts,
        time: ride.streams.time,
        distance: ride.streams.distance,
        altitude: ride.streams.altitude,
        heartrate: ride.streams.heartrate,
        paused: ride.streams.paused,
        ftp: profile.ftp,
      });
    };

    const still = run();
    const windAware = headwind ? run({ headwind }) : still;
    // Over a ride that starts and ends at rest, net kinetic work is zero, so
    // what the kinetic term adds to MEAN power is the cost of accelerating away
    // from lights and nothing else. A large figure is the negative clamp
    // rectifying differentiation noise, and that scales with the device rather
    // than the rider — so it showing up here differently on FIT and GPX files
    // is the signal that the estimate has become device-dependent again.
    const bare = run({ headwind, withoutKinetic: true });
    if (still.distanceMeters < 300) continue;

    out.push({
      name: row.name,
      distanceKm: still.distanceMeters / 1000,
      hours: still.movingSeconds / 3600,
      strava: row.avgWatts,
      measured: row.powerCount > 0,
      still: still.meanPower,
      windAware: windAware.meanPower,
      weighted: windAware.weightedPower,
      kinetic: windAware.meanPower - bare.meanPower,
      relativeEffort: row.relativeEffort,
      load: windAware.load,
      avgHr: row.avgHr,
      speedSource: ride.streams.speed
        ? ride.streams.speedIsDerived
          ? "derived"
          : "device"
        : "none",
      altitudeSource: ride.meta.altitudeSource,
      hasCadence: ride.streams.cadence !== undefined,
    });
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function main() {
  const exportDir = process.argv[2];
  if (!exportDir) {
    console.error("usage: npm run audit:power -- <path-to-strava-export>");
    process.exit(1);
  }

  // Read the rider's real settings if they have been exported from the browser,
  // otherwise the comparison is against a 75 kg stranger.
  const settingsPath = join(process.cwd(), "rider-settings.json");
  const settings: RiderSettings = existsSync(settingsPath)
    ? { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsPath, "utf8")) }
    : DEFAULT_SETTINGS;

  console.log(
    `\nrider ${settings.riderKg} kg + bike ${settings.bikeKg} kg · ` +
      `${settings.positionId} · ${settings.surfaceId} · FTP ${settings.ftp} W` +
      (settings.configured ? "" : "  (DEFAULTS — not the rider's real numbers)"),
  );

  const rows = await compare(exportDir, settings);
  rows.sort((a, b) => b.distanceKm - a.distanceKm);

  const h = [
    "ride".padEnd(18),
    "km".padStart(6),
    "h".padStart(5),
    "spd".padStart(7),
    "alt".padStart(5),
    "cad".padStart(4),
    "hr".padStart(4),
    "strava".padStart(7),
    "ryda".padStart(6),
    "wind".padStart(6),
    "r/s".padStart(5),
    "wtd".padStart(5),
    "VI".padStart(5),
    "EF".padStart(5),
    "kin".padStart(5),
  ].join(" ");
  console.log("\n" + h);
  console.log("-".repeat(h.length));

  const ratios: number[] = [];
  const efs: { ef: number; row: Comparison }[] = [];
  for (const r of rows) {
    const ratio = r.strava > 0 ? r.windAware / r.strava : NaN;
    if (Number.isFinite(ratio) && !r.measured) ratios.push(ratio);
    const vi = r.windAware > 0 ? r.weighted / r.windAware : NaN;
    const ef = r.avgHr > 0 ? r.weighted / r.avgHr : NaN;
    if (Number.isFinite(ef)) efs.push({ ef, row: r });
    console.log(
      [
        r.name.slice(0, 18).padEnd(18),
        r.distanceKm.toFixed(1).padStart(6),
        r.hours.toFixed(2).padStart(5),
        r.speedSource.padStart(7),
        r.altitudeSource.slice(0, 4).padStart(5),
        (r.hasCadence ? "yes" : "—").padStart(4),
        String(r.avgHr || "—").padStart(4),
        (r.strava ? `${r.strava}${r.measured ? "*" : ""}` : "—").padStart(7),
        r.still.toFixed(0).padStart(6),
        r.windAware.toFixed(0).padStart(6),
        (Number.isFinite(ratio) ? ratio.toFixed(2) : "—").padStart(5),
        r.weighted.toFixed(0).padStart(5),
        (Number.isFinite(vi) ? vi.toFixed(2) : "—").padStart(5),
        (Number.isFinite(ef) ? ef.toFixed(2) : "—").padStart(5),
        r.kinetic.toFixed(1).padStart(5),
      ].join(" "),
    );
  }

  // Efficiency factor is the sharpest instrument available without a meter.
  // Heart rate does not care which device wrote the file, so for one rider over
  // a few weeks EF should be nearly flat. Whatever spread it shows is the
  // estimator's own inconsistency, and grouping that spread by how the file
  // recorded speed says whether the fault is the rider's legs or our maths.
  const efValues = efs.map((e) => e.ef);
  const mean = efValues.reduce((a, b) => a + b, 0) / (efValues.length || 1);
  const sd = Math.sqrt(
    efValues.reduce((a, b) => a + (b - mean) ** 2, 0) / (efValues.length || 1),
  );
  console.log(
    `\n${rows.length} rides · median Ryda/Strava ${median(ratios).toFixed(2)}` +
      `\nEF spread: mean ${mean.toFixed(2)} sd ${sd.toFixed(2)} ` +
      `(${((sd / mean) * 100).toFixed(0)}% CV) — should be near flat for one rider`,
  );

  const bySpeed = new Map<string, number[]>();
  for (const { ef, row } of efs) {
    const key = `${row.speedSource}/${row.altitudeSource}`;
    bySpeed.set(key, [...(bySpeed.get(key) ?? []), ef]);
  }
  console.log("\nEF grouped by how the file recorded speed / altitude:");
  for (const [key, list] of bySpeed) {
    const kin = rows.filter((r) => `${r.speedSource}/${r.altitudeSource}` === key);
    console.log(
      `  ${key.padEnd(16)} n=${String(list.length).padStart(2)} ` +
        `median EF ${median(list).toFixed(2)}  ` +
        `median kinetic ${median(kin.map((r) => r.kinetic)).toFixed(1)} W`,
    );
  }
  console.log("\n* = Strava had a real power meter for that ride\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
