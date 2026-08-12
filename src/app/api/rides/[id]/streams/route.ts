import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import type { ChannelName, WireStreams } from "@/lib/sync/wire";

/**
 * The sample streams for one ride.
 *
 * Separate from the summary because it is three orders of magnitude larger and
 * almost nothing needs it: only the ride screen, and only for the ride actually
 * open.
 */
export async function GET(request: Request, context: RouteContext<"/api/rides/[id]/streams">) {
  const user = await requireUser(request);
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });

  const { id } = await context.params;

  // Ownership is checked in the same query that fetches the data, so there is
  // no window where a row is loaded before anyone asks whose it is.
  const [row] = await db
    .select()
    .from(schema.rideStreams)
    .where(and(eq(schema.rideStreams.rideId, id), eq(schema.rideStreams.userId, user.id)))
    .limit(1);

  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  const [ride] = await db
    .select({
      altitudeSource: schema.rides.altitudeSource,
      speedIsDerived: schema.rides.speedIsDerived,
    })
    .from(schema.rides)
    .where(and(eq(schema.rides.id, id), eq(schema.rides.userId, user.id)))
    .limit(1);

  const channels: Partial<Record<ChannelName, string>> = {};
  const add = (name: ChannelName, value: Uint8Array | null) => {
    if (value) channels[name] = Buffer.from(value).toString("base64");
  };
  add("time", row.time);
  add("distance", row.distance);
  add("altitude", row.altitude);
  add("latlng", row.latlng);
  add("speed", row.speed);
  add("heartrate", row.heartrate);
  add("cadence", row.cadence);
  add("power", row.power);
  add("temperature", row.temperature);
  add("paused", row.paused);

  const wire: WireStreams = {
    sampleCount: row.sampleCount,
    altitudeSource:
      (ride?.altitudeSource as WireStreams["altitudeSource"]) ?? "gps",
    // Whether speed was integrated rather than measured changes how hard the
    // estimator smooths it, so it is stored rather than guessed from which
    // columns are populated — a GPX carries a speed channel that was derived,
    // and treating it as measured puts the device bias straight back.
    speedIsDerived: ride?.speedIsDerived ?? true,
    channels,
  };

  return Response.json(wire);
}
