import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  computeTrainingLoad,
  consistency,
  rampRate,
} from "@/lib/analysis/training-load";
import { localToday } from "@/lib/analysis/calendar";

/**
 * The fitness / fatigue / form curve, as a dense daily series.
 *
 * Exists so a client does not have to pull an entire library and re-derive it.
 * The curve is a 42-day and 7-day EWMA over calendar days, and the classic way
 * to get it wrong is to iterate activities instead of days, which makes fitness
 * only ever rise — there is a regression test in this repo pinning exactly that.
 * One implementation, here.
 *
 *   GET /api/trend?days=180&today=2026-08-12
 */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });

  const url = new URL(request.url);
  const days = clampInt(url.searchParams.get("days"), 7, 1825, 180);

  const rides = await db
    .select({ localDate: schema.rides.localDate, load: schema.rides.load })
    .from(schema.rides)
    .where(eq(schema.rides.userId, user.id))
    .orderBy(desc(schema.rides.startedAt));

  if (rides.length === 0) {
    return Response.json({ hasRides: false, series: [] });
  }

  const today = localToday(
    url.searchParams.get("today"),
    rides.map((r) => r.localDate),
  );

  const full = computeTrainingLoad(
    rides.map((r) => ({ date: r.localDate, load: r.load })),
    { to: today },
  );
  const series = full.slice(-days);
  const now = full[full.length - 1];

  return Response.json({
    hasRides: true,
    asOf: today,
    // Ramp rate and consistency read the whole curve, not the windowed slice —
    // a 30-day view must not change what "fitness gained this week" means.
    rampRate: round(rampRate(full)),
    consistency: round(consistency(full), 2),
    fitness: round(now.fitness),
    fatigue: round(now.fatigue),
    form: round(now.form),
    series: series.map((p) => ({
      date: p.date,
      load: round(p.load),
      fitness: round(p.fitness, 1),
      fatigue: round(p.fatigue, 1),
      form: round(p.form, 1),
    })),
  });
}

function round(value: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function clampInt(raw: string | null, lo: number, hi: number, fallback: number): number {
  const v = Number(raw);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.trunc(v)));
}
