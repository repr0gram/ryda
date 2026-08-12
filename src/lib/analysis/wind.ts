import type { RideStreams } from "@/lib/analysis/types";

/**
 * Wind correction.
 *
 * Wind is the largest error left in the estimate once grade is handled properly,
 * and unlike grade it cannot be recovered from the trace at all — a headwind and
 * a hard effort look identical in speed and altitude. It has to come from
 * outside.
 *
 * It matters more than "it averages out" suggests. Drag goes as the square of
 * air speed, so an out-and-back in wind costs strictly more than the same ride
 * in still air: at 8 m/s into a 3 m/s headwind, drag is (11/8)² = 1.9x, and with
 * it behind you (5/8)² = 0.4x. The mean of those is 1.15, not 1. Ignoring wind
 * therefore does not produce noise that cancels — it produces a systematic
 * under-estimate on windy days, which then reads as a bad day on the fitness
 * curve rather than a windy one.
 */

/** Wind as reported by a weather service: a speed and the direction it blows FROM. */
export interface WindObservation {
  /** Mean wind speed at the measurement height, m/s. */
  speedMs: number;
  /** Meteorological bearing — degrees clockwise from north, pointing upwind. */
  bearingDeg: number;
  /** Height of the measurement above ground, m. Met standard is 10 m. */
  measuredAtM?: number;
}

/** Standard anemometer height for surface wind observations, metres. */
const MET_MEASUREMENT_HEIGHT_M = 10;

/** Height of a rider's torso — where nearly all the drag area sits — metres. */
const RIDER_HEIGHT_M = 1.5;

/**
 * Surface roughness length, metres.
 *
 * The log wind profile is u(z2) = u(z1)·ln(z2/z0)/ln(z1/z0), so z0 sets how
 * much slower the air is at rider height than at the 10 m anemometer. The choice
 * dominates the whole correction: tabulated values run from 0.03 m for open
 * grassland to 1 m for suburbs, which at 1.5 m works out as anywhere between 67%
 * and 18% of the reported speed.
 *
 * 0.1 m is deliberately toward the open end of that range. Roads are corridors —
 * more exposed than the terrain either side of them — and the failure modes are
 * not symmetric: under-correcting leaves some of the existing error in place,
 * while over-correcting invents watts that were never produced.
 *
 * `fitRoughnessLength` in scripts/audit-power.ts re-derives this from a rider's
 * own history by finding the value that makes power-per-heartbeat most
 * consistent across their windy and still days.
 */
export const ROUGHNESS_LENGTH_M = 0.1;

/** Metres per degree of latitude. Constant enough at cycling scales. */
const M_PER_DEG_LAT = 111_320;

/**
 * Distance over which heading is measured, metres.
 *
 * Consecutive 1 Hz fixes are ~7 m apart and GPS scatter is several metres, so a
 * heading taken between neighbours is mostly noise. Averaging over a longer
 * baseline costs cornering detail, which does not matter: what the wind term
 * needs is the direction of travel over the next few seconds.
 */
const HEADING_WINDOW_M = 40;

/**
 * Scale a wind speed from its measurement height down to rider height.
 *
 * Log wind profile, u(z2) = u(z1)·ln(z2/z0)/ln(z1/z0). Zero-plane displacement
 * is left out: it applies inside a canopy of uniform obstacles, and a road is
 * not one.
 */
export function windAtRiderHeight(
  speedMs: number,
  measuredAtM = MET_MEASUREMENT_HEIGHT_M,
  roughnessM = ROUGHNESS_LENGTH_M,
): number {
  if (!(speedMs > 0)) return 0;
  const reference = Math.log(measuredAtM / roughnessM);
  if (!(reference > 0)) return speedMs;
  const rider = Math.log(RIDER_HEIGHT_M / roughnessM);
  // Below the roughness length the log law goes negative, which is the model
  // running out of validity rather than the wind reversing.
  return rider <= 0 ? 0 : speedMs * (rider / reference);
}

/**
 * Direction of travel at every sample, radians clockwise from north.
 *
 * Uses an equirectangular approximation rather than great-circle: over a 40 m
 * baseline the difference is far below GPS noise.
 */
export function headingSeries(streams: RideStreams): Float32Array | null {
  const { latlng, distance } = streams;
  const n = streams.time.length;
  if (!latlng || latlng.length < 4) return null;

  const out = new Float32Array(n);
  const half = HEADING_WINDOW_M / 2;
  let lo = 0;
  let hi = 0;
  let last = 0;

  for (let i = 0; i < n; i++) {
    // Both pointers only move forward, so this stays linear.
    while (lo < i && distance[i] - distance[lo] > half) lo++;
    while (hi < n - 1 && distance[hi] - distance[i] < half) hi++;

    const lat1 = latlng[lo * 2];
    const lon1 = latlng[lo * 2 + 1];
    const lat2 = latlng[hi * 2];
    const lon2 = latlng[hi * 2 + 1];

    const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
    const north = (lat2 - lat1) * M_PER_DEG_LAT;
    const east = (lon2 - lon1) * M_PER_DEG_LAT * Math.cos(midLat);

    if (north === 0 && east === 0) {
      // Stationary, or the window collapsed. Hold the last known heading rather
      // than snapping to north, which would flip the wind term for no reason.
      out[i] = last;
      continue;
    }
    last = Math.atan2(east, north);
    out[i] = last;
  }
  return out;
}

/**
 * Headwind component along the direction of travel at every sample, m/s.
 * Positive opposes the rider.
 *
 * With a meteorological bearing pointing upwind, the component resolves to
 * w·cos(bearing − heading): riding straight at the direction the wind comes
 * from is a full headwind, and the reverse is a full tailwind.
 *
 * Returns null when the ride has no positions, since without a heading there is
 * no way to know whether the wind helps or hurts — and assuming is worse than
 * declining.
 */
export function headwindSeries(
  streams: RideStreams,
  wind: WindObservation,
  roughnessM = ROUGHNESS_LENGTH_M,
): Float32Array | null {
  const heading = headingSeries(streams);
  if (!heading) return null;

  const speed = windAtRiderHeight(wind.speedMs, wind.measuredAtM, roughnessM);
  if (speed === 0) return new Float32Array(heading.length);

  const bearing = wind.bearingDeg * (Math.PI / 180);
  const out = new Float32Array(heading.length);
  for (let i = 0; i < heading.length; i++) {
    out[i] = speed * Math.cos(bearing - heading[i]);
  }
  return out;
}

/** Build an observation from a Strava export's weather columns, if both are present. */
export function windFromCsv(
  speedMs: number | null,
  bearingDeg: number | null,
): WindObservation | null {
  if (speedMs === null || bearingDeg === null) return null;
  if (!Number.isFinite(speedMs) || !Number.isFinite(bearingDeg)) return null;
  if (speedMs < 0 || speedMs > 40) return null;
  return { speedMs, bearingDeg };
}
