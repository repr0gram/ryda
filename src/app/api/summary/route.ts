import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  computeTrainingLoad,
  consistency,
  rampRate,
} from "@/lib/analysis/training-load";

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
      elevationGainMeters: schema.rides.elevationGainMeters,
    })
    .from(schema.rides)
    .where(eq(schema.rides.userId, user.id))
    .orderBy(desc(schema.rides.startedAt));

  if (rides.length === 0) {
    return Response.json({ hasRides: false });
  }

  // The curve has to run to today, not to the last ride: form recovers on rest
  // days, and a widget that stopped updating after your last ride would show
  // you as buried all week.
  const today = new Date().toISOString().slice(0, 10);
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
    },
    rideCount: rides.length,
  });
}

function round(value: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
