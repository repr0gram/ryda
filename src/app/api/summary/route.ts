import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  computeTrainingLoad,
  consistency,
  rampRate,
} from "@/lib/analysis/training-load";
import { dayDiff, localToday } from "@/lib/analysis/calendar";
import { DEFAULT_SETTINGS } from "@/lib/rider-settings";
import { energyFor } from "@/lib/analysis/metrics";

/**
 * Everything a home-screen widget needs, in one request.
 *
 * A widget gets woken by the OS on a budget, cannot page through endpoints, and
 * has no room for a spinner. So the shaping happens here: the server runs the
 * fitness curve and returns the four numbers a glance is for, rather than
 * shipping a season of rides for a phone to re-derive them.
 *
 * That is also why the ride pipeline is worth keeping server-side. A native app
 * re-implementing the power model in Swift would be a second implementation to
 * keep in step with the first, and the two would disagree within a month.
 *
 *   GET /api/summary
 *   Authorization: Bearer <session token>
 */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });

  const rides = await db
    .select({
      id: schema.rides.id,
      name: schema.rides.name,
      localDate: schema.rides.localDate,
      startedAt: schema.rides.startedAt,
      load: schema.rides.load,
      distanceMeters: schema.rides.distanceMeters,
      movingSeconds: schema.rides.movingSeconds,
      weightedPower: schema.rides.weightedPower,
      meanPower: schema.rides.meanPower,
      reportedCalories: schema.rides.reportedCalories,
      elevationGainMeters: schema.rides.elevationGainMeters,
    })
    .from(schema.rides)
    .where(eq(schema.rides.userId, user.id))
    .orderBy(desc(schema.rides.startedAt));

  if (rides.length === 0) {
    return Response.json({ hasRides: false });
  }

  const [settings] = await db
    .select({ ftp: schema.riderSettings.ftp, configured: schema.riderSettings.configured })
    .from(schema.riderSettings)
    .where(eq(schema.riderSettings.userId, user.id))
    .limit(1);

  // The curve has to run to today, not to the last ride: form recovers on rest
  // days, and a widget that stopped updating after your last ride would show
  // you as buried all week.
  //
  // Today comes from the caller, because the server is in UTC and the rider is
  // not. See localToday — getting this from the server clock puts an evening
  // ride in Montreal a day in the past before the rider is home.
  const today = localToday(
    new URL(request.url).searchParams.get("today"),
    rides.map((r) => r.localDate),
  );
  const series = computeTrainingLoad(
    rides.map((r) => ({ date: r.localDate, load: r.load })),
    { to: today },
  );
  const now = series[series.length - 1];
  const week = series.slice(-7);
  const latest = rides[0];

  return Response.json({
    hasRides: true,
    asOf: today,
    fitness: round(now.fitness),
    fatigue: round(now.fatigue),
    form: round(now.form),
    rampRate: round(rampRate(series)),
    consistency: round(consistency(series), 2),
    loadLast7Days: round(week.reduce((a, d) => a + d.load, 0)),
    daysSinceLastRide: dayDiff(latest.localDate, today),
    latestRide: {
      id: latest.id,
      name: latest.name,
      startedAt: latest.startedAt.toISOString(),
      distanceKm: round(latest.distanceMeters / 1000, 1),
      movingSeconds: latest.movingSeconds,
      elevationGainMeters: Math.round(latest.elevationGainMeters),
      weightedPower: Math.round(latest.weightedPower),
      load: round(latest.load),
      calories: Math.round(
        energyFor(latest.reportedCalories, latest.meanPower, latest.movingSeconds).calories,
      ),
    },
    rideCount: rides.length,
    // A client showing watts has to be able to say whose watts they are. Without
    // this it cannot tell a rider's real threshold from the 250 W default, and
    // every number it prints is confidently wrong about someone else.
    ftp: settings?.ftp ?? DEFAULT_SETTINGS.ftp,
    settingsConfigured: settings?.configured ?? false,
  });
}

function round(value: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
