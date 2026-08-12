/**
 * Which day is "today" for a rider on a server that lives in UTC.
 *
 * `localDate` on a ride is deliberately the rider's own calendar day — an
 * evening ride belongs to the evening, not to tomorrow. But a server has no
 * timezone of its own, and `new Date().toISOString().slice(0, 10)` is UTC, so
 * the two disagree for most of the world for part of every day:
 *
 *   Montreal, UTC-4, ride at 20:00 local   localDate 2026-08-12, UTC 2026-08-13
 *     -> "1 day since your last ride", the moment you get home
 *   Auckland, UTC+12, ride at 09:00 local  localDate 2026-08-13, UTC 2026-08-12
 *     -> a negative day count, and if every ride is "in the future" the dense
 *        series comes back empty and reading its last element throws
 *
 * So the client sends its own date, and the server only falls back to UTC when
 * it doesn't. The fallback is then clamped to the newest ride the rider has,
 * which cannot fix the count being a day out but does stop the second failure
 * from being a 500.
 */
export function localToday(supplied: string | null, knownDates: string[]): string {
  if (supplied && /^\d{4}-\d{2}-\d{2}$/.test(supplied) && !Number.isNaN(Date.parse(supplied))) {
    return supplied;
  }
  const utc = new Date().toISOString().slice(0, 10);
  let latest = utc;
  for (const d of knownDates) if (d > latest) latest = d;
  return latest;
}

/** Whole days between two YYYY-MM-DD strings, treated as UTC midnights. */
export function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
