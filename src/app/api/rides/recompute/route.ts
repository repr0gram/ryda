import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { recomputeRides } from "@/lib/analysis/recompute";
import { DEFAULT_SETTINGS, sanitise } from "@/lib/rider-settings";

/**
 * Re-derive every stored summary from the samples, with the rider's current
 * numbers and the current model.
 *
 * Runs automatically when settings change. Exposed on its own as well, because
 * the other thing that invalidates a stored summary is the model improving,
 * and that happens on deploy rather than on any user action.
 */
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return Response.json({ error: "sign in first" }, { status: 401 });

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

  const limit = Number(new URL(request.url).searchParams.get("limit")) || 500;
  const result = await recomputeRides(user.id, settings, limit);
  return Response.json({ ...result, settingsSource: saved ? "saved" : "default" });
}
