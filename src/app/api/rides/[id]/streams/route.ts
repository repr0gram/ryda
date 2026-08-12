import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { estimatePower } from "@/lib/analysis/power";
import { computeRideMetrics, energyFor } from "@/lib/analysis/metrics";
import {
  HEART_RATE_ZONES,
  POWER_ZONES,
  movingOnly,
  zoneBreakdown,
} from "@/lib/analysis/zones";
import { DEFAULT_SETTINGS, sanitise, toProfile } from "@/lib/rider-settings";
import { decodeStoredStreams, encodeChannel, type ChannelName } from "@/lib/sync/wire";
import { decimationIndices, gather } from "@/lib/sync/decimate";

/**
 * The sample streams for one ride, and optionally what they mean.
 *
 * Two clients read this and they want different things. The web app pulls raw
 * streams during sync and re-analyses locally, because it already carries the
 * whole model. A native app carries none of it — and must not, since a second
 * implementation of the power model would diverge from this one within a month.
 *
 * So the analysis is opt-in rather than always-on:
 *
 *   ?include=power        estimated watts, metrics, zones, confidence
 *   ?maxSamples=2000      decimate the channels a chart will draw
 *
 * Making it unconditional would charge every sync for a computation it discards.
 */
export async function GET(request: Request, context: RouteContext<"/api/rides/[id]/streams">) {
  const user = await requireUser(request);
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });

  const { id } = await context.params;
  const url = new URL(request.url);
  const include = new Set((url.searchParams.get("include") ?? "").split(",").filter(Boolean));
  const maxSamples = clampInt(url.searchParams.get("maxSamples"), 0, 200_000, 0);

  // Ownership is checked in the same query that fetches the data, so there is
  // no window where a row is loaded before anyone asks whose it is.
  const [row] = await db
    .select()
    .from(schema.rideStreams)
    .where(and(eq(schema.rideStreams.rideId, id), eq(schema.rideStreams.userId, user.id)))
    .limit(1);

  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  const [ride] = await db
    .select()
    .from(schema.rides)
    .where(and(eq(schema.rides.id, id), eq(schema.rides.userId, user.id)))
    .limit(1);

  const { streams, meta } = decodeStoredStreams(
    row,
    (ride?.altitudeSource as "barometric" | "gps" | "dem") ?? "gps",
    // Whether speed was integrated rather than measured changes how hard the
    // estimator smooths it, so it is stored rather than guessed from which
    // columns are populated — a GPX carries a speed channel that was derived,
    // and treating it as measured puts the device bias straight back.
    ride?.speedIsDerived ?? true,
  );

  let analysis: AnalysisBlock | undefined;

  if (include.has("power")) {
    const [saved] = await db
      .select()
      .from(schema.riderSettings)
      .where(eq(schema.riderSettings.userId, user.id))
      .limit(1);

    const settings = saved
      ? sanitise({
          riderKg: saved.riderKg,
          bikeKg: saved.bikeKg,
          positionId: saved.positionId,
          surfaceId: saved.surfaceId,
          ftp: saved.ftp,
          lthr: saved.lthr,
          configured: saved.configured,
        })
      : DEFAULT_SETTINGS;

    const profile = toProfile(settings);
    const { watts, confidence } = estimatePower(streams, meta, profile);

    // Metrics and zones come from the FULL series, before any decimation. This
    // is the whole argument for computing here: the numbers stay correct even
    // when the samples the phone receives are a tenth of the ride.
    const metrics = computeRideMetrics({
      watts,
      time: streams.time,
      distance: streams.distance,
      altitude: streams.altitude,
      heartrate: streams.heartrate,
      paused: streams.paused,
      ftp: profile.ftp,
    });

    const movingWatts = movingOnly(watts, streams.distance, streams.time, streams.paused);
    const movingHr = streams.heartrate
      ? movingOnly(streams.heartrate, streams.distance, streams.time, streams.paused)
      : null;

    analysis = {
      estimatedPower: watts,
      settings,
      settingsSource: saved ? "saved" : "default",
      metrics,
      confidence,
      zones: {
        power: zoneBreakdown(movingWatts, settings.ftp, POWER_ZONES, "W"),
        heartRate:
          movingHr && settings.lthr > 0
            ? zoneBreakdown(movingHr, settings.lthr, HEART_RATE_ZONES, "bpm")
            : null,
      },
    };
  }

  // Decimate against the sharpest channel this ride has, so the surviving
  // indices are the ones that matter for the busiest chart.
  const pacer =
    analysis?.estimatedPower ?? streams.speed ?? streams.heartrate ?? streams.altitude;
  const indices =
    maxSamples > 0 && meta.n > maxSamples
      ? decimationIndices(pacer, meta.n, maxSamples)
      : null;

  const channels: Partial<Record<ChannelName, string>> = {};
  const put = (name: ChannelName, view: ArrayBufferView | undefined, stride = 1) => {
    if (!view) return;
    const typed = view as Float64Array | Float32Array | Uint8Array;
    channels[name] = encodeChannel(indices ? gather(typed, indices, stride) : typed);
  };
  put("time", streams.time);
  put("distance", streams.distance);
  put("altitude", streams.altitude);
  put("latlng", streams.latlng, 2);
  put("speed", streams.speed);
  put("heartrate", streams.heartrate);
  put("cadence", streams.cadence);
  put("power", streams.power);
  put("temperature", streams.temperature);
  put("paused", streams.paused);

  return Response.json({
    sampleCount: indices ? indices.length : meta.n,
    fullSampleCount: meta.n,
    altitudeSource: meta.altitudeSource,
    speedIsDerived: streams.speedIsDerived === true,
    channels,
    ...(analysis
      ? {
          estimate: {
            // Deliberately outside `channels`. If estimated watts were a channel
            // name, POST /api/rides would accept one, and an estimate would end
            // up in the column that means "a real power meter was present".
            channel: encodeChannel(
              indices ? gather(analysis.estimatedPower, indices) : analysis.estimatedPower,
            ),
            source: streams.power ? "measured" : "estimated",
            settings: analysis.settings,
            settingsSource: analysis.settingsSource,
            confidence: analysis.confidence,
          },
          // Energy travels with the metrics rather than being derived on the
          // client, and resolved exactly as the ride list resolves it, so the
          // same ride cannot read differently on two screens.
          analysis: {
            ...analysis.metrics,
            ...energyFor(
              ride?.reportedCalories,
              analysis.metrics.meanPower,
              analysis.metrics.movingSeconds,
            ),
          },
          zones: analysis.zones,
          ride: ride ? summaryOf(ride) : null,
        }
      : {}),
  });
}

interface AnalysisBlock {
  estimatedPower: Float32Array;
  settings: ReturnType<typeof sanitise>;
  settingsSource: "saved" | "default";
  metrics: ReturnType<typeof computeRideMetrics>;
  confidence: ReturnType<typeof estimatePower>["confidence"];
  zones: {
    power: ReturnType<typeof zoneBreakdown>;
    heartRate: ReturnType<typeof zoneBreakdown> | null;
  };
}

/** The summary block, so opening a ride from a deep link needs no second call. */
function summaryOf(ride: typeof schema.rides.$inferSelect) {
  return {
    id: ride.id,
    name: ride.name,
    startedAt: ride.startedAt.toISOString(),
    localDate: ride.localDate,
    sport: ride.sport,
    hasMeasuredPower: ride.hasMeasuredPower,
    devices: ride.devices,
    durationSeconds: ride.durationSeconds,
    movingSeconds: ride.movingSeconds,
    distanceMeters: ride.distanceMeters,
    elevationGainMeters: ride.elevationGainMeters,
  };
}

function clampInt(raw: string | null, lo: number, hi: number, fallback: number): number {
  const v = Number(raw);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.trunc(v)));
}
