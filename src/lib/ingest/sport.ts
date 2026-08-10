/**
 * Sport classification.
 *
 * This exists because the power model is cycling physics — rolling resistance
 * on tyres, a drag area for a rider on a bike, a drivetrain efficiency. Applied
 * to a walk it does not produce a slightly wrong number, it produces a
 * meaningless one, and that meaningless number then flows into training load
 * and distorts the fitness curve.
 *
 * Nearly half of a real Strava export turned out to be walks.
 */

export type SportKind = "cycling" | "other";

const CYCLING = new Set([
  "cycling",
  "ride",
  "biking",
  "bike",
  "virtualride",
  "virtual_ride",
  "ebikeride",
  "gravelride",
  "mountainbikeride",
  "handcycle",
  "velomobile",
]);

/** Normalise the many spellings devices and exporters use. */
export function normaliseSport(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function sportKind(raw: string | null | undefined): SportKind {
  const s = normaliseSport(raw).replace(/_/g, "");
  return CYCLING.has(s) ? "cycling" : "other";
}

export function isCycling(raw: string | null | undefined): boolean {
  return sportKind(raw) === "cycling";
}

/** Human label for the library and ride header. */
export function sportLabel(raw: string | null | undefined): string {
  const s = normaliseSport(raw);
  if (s === "unknown") return "Activity";
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
