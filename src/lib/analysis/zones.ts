import { restingMask, timeInZones } from "./metrics";
import { movingAverage } from "./signal";

/**
 * Training zones.
 *
 * Zone schemes are conventions, not measurements — the boundaries are round
 * fractions of a reference effort that somebody chose, and different coaches
 * choose differently. What makes them worth showing is that they answer a
 * question a single average cannot: two rides with the same mean power can be
 * a steady endurance ride and an interval session, and only the distribution
 * tells them apart.
 */

export interface Zone {
  /** 1-based zone number. */
  index: number;
  name: string;
  /** What the zone is for, in one line. */
  purpose: string;
  /** Upper bound as a fraction of the reference; Infinity for the last zone. */
  upper: number;
  token: string;
}

/**
 * Power zones as fractions of threshold power.
 *
 * The seven-zone scheme in general use, with the boundaries stated as ratios so
 * they move with the rider's threshold rather than being re-entered.
 */
export const POWER_ZONES: Zone[] = [
  { index: 1, name: "Active recovery", purpose: "easy spinning", upper: 0.55, token: "--zone-1" },
  { index: 2, name: "Endurance", purpose: "all-day pace", upper: 0.75, token: "--zone-2" },
  { index: 3, name: "Tempo", purpose: "comfortably hard", upper: 0.9, token: "--zone-3" },
  { index: 4, name: "Threshold", purpose: "about an hour flat out", upper: 1.05, token: "--zone-4" },
  { index: 5, name: "VO₂ max", purpose: "three to eight minutes", upper: 1.2, token: "--zone-5" },
  { index: 6, name: "Anaerobic", purpose: "under two minutes", upper: 1.5, token: "--zone-6" },
  { index: 7, name: "Neuromuscular", purpose: "sprints", upper: Infinity, token: "--zone-7" },
];

/**
 * Heart-rate zones as fractions of lactate threshold heart rate.
 *
 * Anchored on LTHR rather than maximum heart rate, because LTHR is measurable
 * from a hard ride whereas a true maximum needs an effort most people never
 * make and mis-estimate badly from `220 − age`.
 *
 * Five zones rather than seven: heart rate lags effort by tens of seconds, so
 * it cannot resolve the short, hard distinctions that the top power zones make.
 */
export const HEART_RATE_ZONES: Zone[] = [
  { index: 1, name: "Recovery", purpose: "conversational", upper: 0.81, token: "--zone-1" },
  { index: 2, name: "Aerobic", purpose: "endurance base", upper: 0.89, token: "--zone-2" },
  { index: 3, name: "Tempo", purpose: "steady work", upper: 0.93, token: "--zone-3" },
  { index: 4, name: "Threshold", purpose: "at your limit", upper: 0.99, token: "--zone-5" },
  { index: 5, name: "Max", purpose: "above threshold", upper: Infinity, token: "--zone-6" },
];

export interface ZoneSlice extends Zone {
  seconds: number;
  fraction: number;
  /** Human-readable range, e.g. "143–158 bpm". */
  range: string;
}

/**
 * Drop the samples where the bike was not moving.
 *
 * A rider waiting at a red light is not spending time in zone 1. Counting it
 * there would make every urban ride look like a recovery spin, and the longer
 * the traffic, the easier the ride would appear.
 */
export function movingOnly(
  values: ArrayLike<number>,
  distance: ArrayLike<number>,
  time: ArrayLike<number>,
  paused: Uint8Array | undefined,
): Float32Array {
  const n = Math.min(values.length, distance.length, time.length);
  const resting = restingMask(distance, time, paused, n);
  let keep = 0;
  for (let i = 0; i < n; i++) if (!resting[i]) keep++;
  const out = new Float32Array(keep);
  let j = 0;
  for (let i = 0; i < n; i++) if (!resting[i]) out[j++] = values[i];
  return out;
}

/**
 * Half-window for smoothing a channel before binning it, in samples at 1 Hz.
 *
 * A zone is a physiological state, and physiology does not change zone for one
 * second. Binning raw samples counts every spike as time spent training that
 * system, which on modelled power is badly wrong: a real 4h25 ride landed 42
 * minutes in the top two zones — three quarters of an hour of sprinting the
 * rider did not do. Thirty-one seconds is the same window Weighted Power
 * already uses, so the two figures on this screen agree about what a hard
 * moment is.
 *
 * Heart rate is smoothed too. It is already a lagged, damped signal, so this
 * costs almost nothing and keeps a dropped beat from registering as recovery.
 */
export const ZONE_SMOOTH_HALF_WINDOW = 15;

/** Split a channel into zones. Feed it `movingOnly` output. */
export function zoneBreakdown(
  values: ArrayLike<number>,
  reference: number,
  zones: Zone[],
  unit: string,
): ZoneSlice[] {
  const finite = zones.filter((z) => Number.isFinite(z.upper));
  const seconds = timeInZones(
    movingAverage(values, ZONE_SMOOTH_HALF_WINDOW),
    finite.map((z) => z.upper * reference),
  );
  const total = seconds.reduce((a, b) => a + b, 0);

  return zones.map((zone, i) => {
    const lower = i === 0 ? 0 : Math.round(zones[i - 1].upper * reference);
    const upper = Number.isFinite(zone.upper) ? Math.round(zone.upper * reference) : null;
    return {
      ...zone,
      seconds: seconds[i] ?? 0,
      fraction: total > 0 ? (seconds[i] ?? 0) / total : 0,
      range: upper === null ? `${lower}+ ${unit}` : `${lower}–${upper} ${unit}`,
    };
  });
}
