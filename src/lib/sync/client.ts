import { buildPowerCurve } from "@/lib/analysis/curve";
import { estimatePower } from "@/lib/analysis/power";
import { toProfile, type RiderSettings } from "@/lib/rider-settings";
import {
  getStreams,
  listRides,
  saveRide,
  type RideSummary,
} from "@/lib/store/rides";
import { decodeStreams, encodeStreams, type WireRide, type WireStreams } from "./wire";
import { differs } from "./diff";

/**
 * Two-way sync between this browser and the account.
 *
 * The local store stays the source of truth for reading — every screen already
 * reads IndexedDB, and going through the network to draw a chart would make the
 * app worse. The server is durability and a second device: somewhere the rides
 * survive clearing site data, and somewhere an iOS app can read them.
 *
 * Reconciliation is by ride id, which is derived from start time and duration.
 * Two devices that import the same file independently converge on the same row
 * rather than two, and there is nothing to merge because a ride is immutable
 * once recorded.
 */

export interface SyncProgress {
  phase: "push" | "pull";
  done: number;
  total: number;
  name: string;
}

export interface SyncResult {
  pushed: number;
  /** Rides already on the server whose numbers had changed here. */
  updated: number;
  pulled: number;
  failed: { id: string; reason: string }[];
}


function toWireRide(summary: RideSummary): WireRide {
  return {
    id: summary.id,
    name: summary.name,
    startedAt: summary.startedAt,
    localDate: summary.localDate,
    sport: summary.sport,
    hasMeasuredPower: summary.hasMeasuredPower,
    devices: summary.devices,
    durationSeconds: summary.durationSeconds,
    movingSeconds: summary.movingSeconds,
    distanceMeters: summary.distanceMeters,
    elevationGainMeters: summary.elevationGainMeters,
    meanPower: summary.meanPower,
    weightedPower: summary.weightedPower,
    load: summary.load,
    meanHeartRate: summary.meanHeartRate,
    reportedCalories: summary.reportedCalories,
    decouplingPercent: summary.decouplingPercent,
    confidence: summary.confidence,
    sampleCount: summary.n,
    altitudeSource: summary.altitudeSource,
  };
}

export async function fetchRemoteRides(): Promise<WireRide[]> {
  const res = await fetch("/api/rides");
  if (res.status === 401) throw new NotSignedInError();
  if (!res.ok) throw new Error(`could not list rides (${res.status})`);
  const body = (await res.json()) as { rides: WireRide[] };
  return body.rides;
}

export class NotSignedInError extends Error {
  constructor() {
    super("not signed in");
    this.name = "NotSignedInError";
  }
}

export async function sync(
  settings: RiderSettings,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult> {
  const [local, remote] = await Promise.all([listRides(), fetchRemoteRides()]);
  const localIds = new Set(local.map((r) => r.id));
  const remoteIds = new Set(remote.map((r) => r.id));

  const result: SyncResult = { pushed: 0, updated: 0, pulled: 0, failed: [] };
  const byId = new Map(remote.map((r) => [r.id, r]));

  const toPush = local.filter((r) => !remoteIds.has(r.id));
  for (let i = 0; i < toPush.length; i++) {
    const summary = toPush[i];
    onProgress?.({ phase: "push", done: i + 1, total: toPush.length, name: summary.name });
    try {
      const stored = await getStreams(summary.id);
      if (!stored) throw new Error("streams missing locally");
      const res = await fetch("/api/rides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ride: toWireRide(summary),
          streams: encodeStreams(stored.streams, stored.meta),
        }),
      });
      if (!res.ok) throw new Error(`server said ${res.status}`);
      result.pushed++;
    } catch (e) {
      result.failed.push({ id: summary.id, reason: reasonOf(e) });
    }
  }

  // Rides the server already has, but whose analysis has moved on here. Sent
  // without streams: the samples have not changed and re-uploading a megabyte
  // per ride to correct six floats would make correcting anything unthinkable.
  const toUpdate = local.filter((r) => {
    const there = byId.get(r.id);
    return there !== undefined && differs(r, there);
  });
  for (let i = 0; i < toUpdate.length; i++) {
    const summary = toUpdate[i];
    onProgress?.({ phase: "push", done: i + 1, total: toUpdate.length, name: summary.name });
    try {
      const res = await fetch("/api/rides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ride: toWireRide(summary) }),
      });
      if (!res.ok) throw new Error(`server said ${res.status}`);
      result.updated++;
    } catch (e) {
      result.failed.push({ id: summary.id, reason: reasonOf(e) });
    }
  }

  const toPull = remote.filter((r) => !localIds.has(r.id));
  for (let i = 0; i < toPull.length; i++) {
    const ride = toPull[i];
    onProgress?.({ phase: "pull", done: i + 1, total: toPull.length, name: ride.name });
    try {
      const res = await fetch(`/api/rides/${encodeURIComponent(ride.id)}/streams`);
      if (!res.ok) throw new Error(`server said ${res.status}`);
      const wire = (await res.json()) as WireStreams;
      const { streams, meta } = decodeStreams(wire);

      // Metrics are recomputed from the streams rather than trusted from the
      // wire. The rider's mass and threshold live on this device, and the model
      // itself changes — a ride pulled down should read the way it would if the
      // file had been imported here.
      const profile = toProfile(settings);
      const { watts, confidence } = estimatePower(streams, meta, profile);
      const { computeRideMetrics } = await import("@/lib/analysis/metrics");
      const metrics = computeRideMetrics({
        watts,
        time: streams.time,
        distance: streams.distance,
        altitude: streams.altitude,
        heartrate: streams.heartrate,
        paused: streams.paused,
        ftp: profile.ftp,
      });

      await saveRide({
        curve: buildPowerCurve(watts).watts,
        ride: {
          streams,
          meta,
          name: ride.name,
          startedAt: ride.startedAt,
          sport: ride.sport,
          hasMeasuredPower: ride.hasMeasuredPower,
          devices: ride.devices,
          gapSeconds: 0,
          reported: {},
        },
        summary: {
          durationSeconds: metrics.durationSeconds,
          movingSeconds: metrics.movingSeconds,
          distanceMeters: metrics.distanceMeters,
          elevationGainMeters: metrics.elevationGainMeters,
          meanPower: metrics.meanPower,
          weightedPower: metrics.weightedPower,
          load: metrics.load,
          meanHeartRate: metrics.meanHeartRate,
          reportedCalories: ride.reportedCalories ?? null,
          decouplingPercent: metrics.decoupling?.percent ?? null,
          confidence: confidence.level,
        },
      });
      result.pulled++;
    } catch (e) {
      result.failed.push({ id: ride.id, reason: reasonOf(e) });
    }
    // Yield so the progress UI can paint between rides.
    await new Promise((r) => setTimeout(r, 0));
  }

  return result;
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : "unknown error";
}

/**
 * Push whatever this browser knows that the account does not, quietly.
 *
 * Called after an import so a ride reaches the phone without anyone having to
 * remember a second step. Importing and syncing being separate actions is how a
 * re-import that picked up a device's calorie figure sat in one browser while
 * every other device kept showing the derived one.
 *
 * Silent by design: it must never interrupt an import, and it does nothing at
 * all when signed out, which is a supported way to use this app rather than an
 * error.
 */
export async function pushQuietly(settings: RiderSettings): Promise<void> {
  try {
    await sync(settings);
  } catch {
    // Signed out, or offline. The Sync button on the account page remains the
    // deliberate path; this is only ever an accelerator.
  }
}
