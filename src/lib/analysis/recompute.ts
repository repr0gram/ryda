import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { estimatePower } from "@/lib/analysis/power";
import { computeRideMetrics } from "@/lib/analysis/metrics";
import { toProfile, type RiderSettings } from "@/lib/rider-settings";
import { decodeStoredStreams } from "@/lib/sync/wire";

/**
 * Re-derive every stored summary from the samples.
 *
 * A ride row carries two kinds of number. The samples are a record of what
 * happened and never change. Mean power, weighted power and load are an
 * *interpretation* of them, and they change whenever the rider's mass or
 * threshold changes, or whenever the model itself improves.
 *
 * Those interpreted numbers were written once, by whichever client uploaded the
 * ride, and then never touched — while the ride screen recomputed them live on
 * every open. So the list and the detail drifted apart and showed different
 * figures for the same ride: 106 W against 137 W, load 80 against 318. Both were
 * honestly computed; they were answers from different days.
 *
 * Running this after any settings change is what keeps one ride to one set of
 * numbers. It is deliberately a write-time job: recomputing on read would mean
 * decoding a megabyte of samples per ride every time a list is drawn.
 */
export interface RecomputeResult {
  recomputed: number;
  failed: number;
  /** Rides left to do, when a limit was hit. */
  remaining: number;
}

export async function recomputeRides(
  userId: string,
  settings: RiderSettings,
  limit = 500,
): Promise<RecomputeResult> {
  const rides = await db
    .select({ id: schema.rides.id, altitudeSource: schema.rides.altitudeSource, speedIsDerived: schema.rides.speedIsDerived })
    .from(schema.rides)
    .where(eq(schema.rides.userId, userId));

  const profile = toProfile(settings);
  const batch = rides.slice(0, limit);
  let recomputed = 0;
  let failed = 0;

  for (const ride of batch) {
    try {
      const [row] = await db
        .select()
        .from(schema.rideStreams)
        .where(
          and(eq(schema.rideStreams.rideId, ride.id), eq(schema.rideStreams.userId, userId)),
        )
        .limit(1);
      if (!row) {
        failed++;
        continue;
      }

      const { streams, meta } = decodeStoredStreams(
        row,
        ride.altitudeSource as "barometric" | "gps" | "dem",
        ride.speedIsDerived,
      );
      const { watts, confidence } = estimatePower(streams, meta, profile);
      const metrics = computeRideMetrics({
        watts,
        time: streams.time,
        distance: streams.distance,
        altitude: streams.altitude,
        heartrate: streams.heartrate,
        paused: streams.paused,
        ftp: profile.ftp,
      });

      await db
        .update(schema.rides)
        .set({
          // Everything an interpretation can touch. reportedCalories is
          // deliberately absent: it comes from the original file, not from the
          // samples, so there is nothing here to re-derive it from.
          movingSeconds: Math.round(metrics.movingSeconds),
          durationSeconds: Math.round(metrics.durationSeconds),
          distanceMeters: metrics.distanceMeters,
          elevationGainMeters: metrics.elevationGainMeters,
          meanPower: metrics.meanPower,
          weightedPower: metrics.weightedPower,
          load: metrics.load,
          meanHeartRate: metrics.meanHeartRate,
          decouplingPercent: metrics.decoupling?.percent ?? null,
          confidence: confidence.level,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.rides.id, ride.id), eq(schema.rides.userId, userId)));
      recomputed++;
    } catch {
      failed++;
    }
  }

  return { recomputed, failed, remaining: Math.max(0, rides.length - batch.length) };
}
