import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { decodeStreams, type WireRide, type WireStreams } from "@/lib/sync/wire";
import { energyFor, kilojoulesFrom } from "@/lib/analysis/metrics";

/**
 * A rider's rides.
 *
 * GET returns summaries only. The library, the trend chart and an iOS widget
 * all want the same thing — a few hundred bytes per ride — and none of them
 * want twenty thousand samples. Streams are a separate request per ride.
 */
export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();

  const rows = await db
    .select()
    .from(schema.rides)
    .where(eq(schema.rides.userId, user.id))
    .orderBy(desc(schema.rides.startedAt));

  return Response.json({ rides: rows.map(toWire) });
}

interface PushBody {
  ride: WireRide;
  streams: WireStreams;
}

/**
 * Store one ride.
 *
 * Idempotent on the ride id, which is derived from start time and duration, so
 * re-syncing a library or re-importing the same export replaces rather than
 * duplicates. That matters more than it sounds: a Strava bulk export is
 * re-downloaded every few months and overlaps everything already stored.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();

  let body: PushBody;
  try {
    body = (await request.json()) as PushBody;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const { ride, streams } = body ?? {};
  if (!ride?.id || !streams?.channels) {
    return Response.json({ error: "expected { ride, streams }" }, { status: 400 });
  }

  // Decode before writing, so a malformed payload fails here rather than
  // becoming a row that every later read has to defend against.
  let decoded;
  try {
    decoded = decodeStreams(streams);
  } catch {
    return Response.json({ error: "streams could not be decoded" }, { status: 400 });
  }
  if (decoded.meta.n !== decoded.streams.time.length) {
    return Response.json({ error: "sampleCount does not match the time channel" }, { status: 400 });
  }

  const values = {
    id: ride.id,
    userId: user.id,
    name: ride.name,
    startedAt: new Date(ride.startedAt),
    localDate: ride.localDate,
    sport: ride.sport,
    sampleCount: decoded.meta.n,
    altitudeSource: decoded.meta.altitudeSource,
    speedIsDerived: streams.speedIsDerived === true,
    hasMeasuredPower: ride.hasMeasuredPower,
    devices: ride.devices ?? [],
    durationSeconds: Math.round(ride.durationSeconds),
    movingSeconds: Math.round(ride.movingSeconds),
    distanceMeters: ride.distanceMeters,
    elevationGainMeters: ride.elevationGainMeters,
    meanPower: ride.meanPower,
    weightedPower: ride.weightedPower,
    load: ride.load,
    meanHeartRate: ride.meanHeartRate,
    reportedCalories: ride.reportedCalories ?? null,
    decouplingPercent: ride.decouplingPercent,
    confidence: ride.confidence,
    updatedAt: new Date(),
  };

  // Conflict target is the composite key: a ride id is only unique within an
  // account, so targeting id alone would let one rider's upload overwrite
  // another's ride when they rode together.
  await db
    .insert(schema.rides)
    .values(values)
    .onConflictDoUpdate({ target: [schema.rides.userId, schema.rides.id], set: values });

  const buffers = {
    rideId: ride.id,
    userId: user.id,
    sampleCount: decoded.meta.n,
    // time, distance and altitude are required by the schema; decodeStreams
    // guarantees them for any payload that got past the length check above.
    time: toBuffer(decoded.streams.time)!,
    distance: toBuffer(decoded.streams.distance)!,
    altitude: toBuffer(decoded.streams.altitude)!,
    latlng: toBuffer(decoded.streams.latlng),
    speed: toBuffer(decoded.streams.speed),
    heartrate: toBuffer(decoded.streams.heartrate),
    cadence: toBuffer(decoded.streams.cadence),
    power: toBuffer(decoded.streams.power),
    temperature: toBuffer(decoded.streams.temperature),
    paused: toBuffer(decoded.streams.paused),
  };

  await db
    .insert(schema.rideStreams)
    .values(buffers)
    .onConflictDoUpdate({
      target: [schema.rideStreams.userId, schema.rideStreams.rideId],
      set: buffers,
    });

  return Response.json({ id: ride.id }, { status: 200 });
}

export async function DELETE(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  // Scoped by user id as well as ride id — the ride id alone is derived from a
  // timestamp, so two accounts can hold the same one.
  const deleted = await db
    .delete(schema.rides)
    .where(and(eq(schema.rides.id, id), eq(schema.rides.userId, user.id)))
    .returning({ id: schema.rides.id });

  // Reporting success for a ride that was never touched hides both a caller bug
  // and a probe for someone else's ride behind the same cheerful 200.
  if (deleted.length === 0) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({ deleted: id });
}

function toBuffer(view: ArrayBufferView | undefined): Uint8Array | null {
  if (!view) return null;
  return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
}

export function toWire(row: typeof schema.rides.$inferSelect): WireRide {
  return {
    id: row.id,
    name: row.name,
    startedAt: row.startedAt.toISOString(),
    localDate: row.localDate,
    sport: row.sport,
    hasMeasuredPower: row.hasMeasuredPower,
    devices: row.devices,
    durationSeconds: row.durationSeconds,
    movingSeconds: row.movingSeconds,
    distanceMeters: row.distanceMeters,
    elevationGainMeters: row.elevationGainMeters,
    meanPower: row.meanPower,
    weightedPower: row.weightedPower,
    load: row.load,
    meanHeartRate: row.meanHeartRate,
    decouplingPercent: row.decouplingPercent,
    confidence: row.confidence,
    sampleCount: row.sampleCount,
    altitudeSource: row.altitudeSource,
    // Mechanical work is always derived; the calorie figure prefers whatever
    // the recording device wrote, and says which it used.
    kilojoules: kilojoulesFrom(row.meanPower, row.movingSeconds),
    ...energyFor(row.reportedCalories, row.meanPower, row.movingSeconds),
  };
}

function unauthorized() {
  return Response.json({ error: "sign in first" }, { status: 401 });
}
