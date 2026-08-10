import { estimatePower } from "@/lib/analysis/power";
import { computeRideMetrics } from "@/lib/analysis/metrics";
import type { ParsedRide } from "@/lib/ingest/fit";
import { toProfile, type RiderSettings } from "@/lib/rider-settings";
import { saveRide, type SaveResult } from "./rides";

/**
 * Turn a parsed file into a stored ride.
 *
 * Metrics are computed once at import and denormalised onto the summary row so
 * the library and the trend chart never touch the sample streams. A season of
 * rides is tens of millions of samples; recomputing them to draw one line is
 * the difference between an instant chart and a spinner.
 */
export async function importRide(
  ride: ParsedRide,
  settings: RiderSettings,
): Promise<SaveResult> {
  const profile = toProfile(settings);
  const { watts, confidence } = estimatePower(ride.streams, ride.meta, profile);
  const metrics = computeRideMetrics({
    watts,
    time: ride.streams.time,
    distance: ride.streams.distance,
    altitude: ride.streams.altitude,
    heartrate: ride.streams.heartrate,
    paused: ride.streams.paused,
    ftp: profile.ftp,
  });

  return saveRide({
    ride,
    summary: {
      durationSeconds: metrics.durationSeconds,
      movingSeconds: metrics.movingSeconds,
      distanceMeters: metrics.distanceMeters,
      elevationGainMeters: metrics.elevationGainMeters,
      meanPower: metrics.meanPower,
      weightedPower: metrics.weightedPower,
      load: metrics.load,
      meanHeartRate: metrics.meanHeartRate,
      decouplingPercent: metrics.decoupling?.percent ?? null,
      confidence: confidence.level,
    },
  });
}

export interface ImportProgress {
  file: string;
  index: number;
  total: number;
}

export interface ImportOutcome {
  added: number;
  replaced: number;
  failed: { file: string; reason: string }[];
}

/**
 * Import many files, continuing past failures.
 *
 * A bulk export is thousands of files and some of them will be corrupt, or a
 * sport this app doesn't model. Aborting the whole import on the first bad file
 * would make the feature useless, so failures are collected and reported.
 */
export async function importFiles(
  files: File[],
  settings: RiderSettings,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { added: 0, replaced: 0, failed: [] };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.({ file: file.name, index: i, total: files.length });
    try {
      const parsed = await parseFile(file);
      const result = await importRide(parsed, settings);
      if (result.replaced) outcome.replaced++;
      else outcome.added++;
    } catch (e) {
      outcome.failed.push({
        file: file.name,
        reason: e instanceof Error ? e.message : "could not be read",
      });
    }
    // Yield to the event loop so the progress UI can actually paint.
    await new Promise((r) => setTimeout(r, 0));
  }

  return outcome;
}

export async function parseFile(file: File): Promise<ParsedRide> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".fit")) {
    const { parseFit } = await import("@/lib/ingest/fit");
    return parseFit(await file.arrayBuffer());
  }
  if (lower.endsWith(".gpx")) {
    const { parseGpx } = await import("@/lib/ingest/gpx");
    return parseGpx(await file.text());
  }
  throw new Error("not a .fit or .gpx file");
}
