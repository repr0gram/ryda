import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  DEFAULT_SETTINGS,
  sanitise,
  type RiderSettings,
} from "@/lib/rider-settings";
import { recomputeRides } from "@/lib/analysis/recompute";

/**
 * The rider's own numbers.
 *
 * Mass, drag area, rolling resistance and threshold scale the power estimate
 * almost linearly, so they are not preferences — they are inputs to the physics.
 * They lived only in browser localStorage, which meant the server could store a
 * ride but could not say what the rider was doing during it, and a native client
 * had no way to ask.
 *
 * `source` is part of the contract rather than a nicety. A client that cannot
 * tell "75 kg because they weigh 75 kg" from "75 kg because nobody asked" will
 * print confidently wrong watts, which is the one failure this whole codebase is
 * organised against.
 */
export interface RiderSettingsResponse {
  settings: RiderSettings;
  source: "saved" | "default";
  /** How many stored rides were re-derived, when a PUT changed anything. */
  recomputed?: number;
}

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();

  const [row] = await db
    .select()
    .from(schema.riderSettings)
    .where(eq(schema.riderSettings.userId, user.id))
    .limit(1);

  const body: RiderSettingsResponse = row
    ? { settings: fromRow(row), source: "saved" }
    : { settings: DEFAULT_SETTINGS, source: "default" };

  return Response.json(body);
}

export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();

  let incoming: Partial<RiderSettings>;
  try {
    incoming = (await request.json()) as Partial<RiderSettings>;
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  // Merge over defaults before validating, so a partial body is filled in rather
  // than rejected, then run the same clamp the browser runs. Untrusted input has
  // to go through the bounds, not around them.
  const settings = sanitise({ ...DEFAULT_SETTINGS, ...incoming });

  const values = {
    userId: user.id,
    riderKg: settings.riderKg,
    bikeKg: settings.bikeKg,
    positionId: settings.positionId,
    surfaceId: settings.surfaceId,
    ftp: settings.ftp,
    lthr: settings.lthr,
    configured: settings.configured,
    updatedAt: new Date(),
  };

  await db
    .insert(schema.riderSettings)
    .values(values)
    .onConflictDoUpdate({ target: schema.riderSettings.userId, set: values });

  // Mass and threshold are inputs to the physics, so changing them invalidates
  // every number already stored for every ride. Re-deriving them here is what
  // stops the ride list and the ride screen disagreeing: the list serves stored
  // figures and the screen recomputes live, and without this they are answers
  // from different days.
  const { recomputed } = await recomputeRides(user.id, settings);

  const body: RiderSettingsResponse = { settings, source: "saved", recomputed };
  return Response.json(body);
}

function fromRow(row: typeof schema.riderSettings.$inferSelect): RiderSettings {
  // Round-trip through the clamp on the way out too. Rows predating a bound
  // change would otherwise reach a client as values it will not accept back.
  return sanitise({
    riderKg: row.riderKg,
    bikeKg: row.bikeKg,
    positionId: row.positionId,
    surfaceId: row.surfaceId,
    ftp: row.ftp,
    lthr: row.lthr,
    configured: row.configured,
  });
}

function unauthorized() {
  return Response.json({ error: "sign in first" }, { status: 401 });
}
