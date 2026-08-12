import { rollingMeanTrailing, savitzkyGolay } from "./signal";

/**
 * Training metrics.
 *
 * The algorithms here are the published ones; the NAMES are deliberately not.
 * "Normalized Power" (US reg. 4450847) and "Training Stress Score" are live,
 * incontestable TrainingPeaks trademarks. The mathematics is free to implement,
 * the names are not — GoldenCheetah renamed its equivalent to IsoPower despite
 * being GPL, and Strava ships "Weighted Average Power" / "Relative Effort".
 *
 *   Weighted Power  <- Normalized Power
 *   Intensity       <- Intensity Factor
 *   Load            <- Training Stress Score
 */

/** The 30-second window is part of the definition, not a tuning knob. */
const WEIGHTED_POWER_WINDOW_S = 30;

/**
 * Weighted Power: 30 s rolling mean, raised to the 4th power, averaged, then
 * the 4th root. The 4th power is what makes surges cost more than their
 * arithmetic share, which is the whole point of the metric.
 *
 * Zeros from coasting are included deliberately — they are part of the
 * physiological cost profile of the ride.
 */
export function weightedPower(watts: ArrayLike<number>): number {
  const n = watts.length;
  if (n === 0) return 0;
  const rolling = rollingMeanTrailing(watts, WEIGHTED_POWER_WINDOW_S);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const v = rolling[i];
    total += v * v * v * v;
  }
  return Math.pow(total / n, 0.25);
}

export function average(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += values[i];
  return s / n;
}

/** Weighted Power as a fraction of threshold. 1.0 means riding at FTP. */
export function intensity(weighted: number, ftp: number): number {
  if (!(ftp > 0)) return 0;
  return weighted / ftp;
}

/**
 * Load: one hour at threshold is exactly 100 by construction.
 *
 *   Load = hours x Intensity^2 x 100
 *
 * Algebraically identical to the (duration x WP x IF) / (FTP x 36) form, but
 * this one makes the invariant obvious.
 */
export function load(durationSeconds: number, weighted: number, ftp: number): number {
  if (!(ftp > 0) || durationSeconds <= 0) return 0;
  const i = intensity(weighted, ftp);
  return (durationSeconds / 3600) * i * i * 100;
}

/** Variability: how surgy the ride was. 1.0 is metronomic. */
export function variability(weighted: number, meanPower: number): number {
  if (!(meanPower > 0)) return 0;
  return weighted / meanPower;
}

/**
 * Efficiency: watts per beat. Only meaningful for steady aerobic riding —
 * comparing it across an interval session and an endurance ride is nonsense.
 */
export function efficiency(weighted: number, meanHeartRate: number): number {
  if (!(meanHeartRate > 0)) return 0;
  return weighted / meanHeartRate;
}

export interface DecouplingResult {
  /** Percent drift. Under 5% is well-coupled aerobic fitness (Friel). */
  percent: number;
  firstHalf: number;
  secondHalf: number;
}

/**
 * Aerobic decoupling (power:HR drift).
 *
 * This metric deserves prominence in an app built on estimated power: it
 * compares the ride to ITSELF, so a systematic bias in the power model cancels
 * between the two halves. It stays trustworthy even when the absolute watts
 * are not.
 */
export function decoupling(
  watts: ArrayLike<number>,
  heartrate: ArrayLike<number>,
): DecouplingResult | null {
  const n = Math.min(watts.length, heartrate.length);
  if (n < 120) return null;
  const mid = Math.floor(n / 2);

  const half = (lo: number, hi: number) => {
    let sw = 0;
    let sh = 0;
    let count = 0;
    for (let i = lo; i < hi; i++) {
      if (!Number.isFinite(heartrate[i]) || heartrate[i] <= 0) continue;
      sw += watts[i];
      sh += heartrate[i];
      count++;
    }
    if (count === 0) return null;
    const meanHr = sh / count;
    return meanHr > 0 ? sw / count / meanHr : null;
  };

  const first = half(0, mid);
  const second = half(mid, n);
  if (first === null || second === null || first === 0) return null;

  return {
    percent: ((first - second) / first) * 100,
    firstHalf: first,
    secondHalf: second,
  };
}

/**
 * Seconds spent in each zone. Boundaries are upper bounds in the same unit as
 * `values`; anything above the last boundary lands in a final overflow bucket.
 */
export function timeInZones(
  values: ArrayLike<number>,
  boundaries: number[],
  sampleSeconds = 1,
): number[] {
  const buckets = new Array<number>(boundaries.length + 1).fill(0);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    let z = boundaries.findIndex((b) => v <= b);
    if (z === -1) z = boundaries.length;
    buckets[z] += sampleSeconds;
  }
  return buckets;
}

export interface RideMetrics {
  durationSeconds: number;
  movingSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  meanPower: number;
  weightedPower: number;
  intensity: number;
  load: number;
  variability: number;
  kilojoules: number;
  meanHeartRate: number | null;
  efficiency: number | null;
  decoupling: DecouplingResult | null;
}

export interface ComputeMetricsInput {
  watts: Float32Array;
  time: Float64Array;
  distance: Float64Array;
  altitude: Float64Array;
  heartrate?: Float32Array;
  /** 1 where the sample was invented to fill a recording pause. */
  paused?: Uint8Array;
  ftp?: number;
}

/** Below this the bike is stopped, not riding slowly. Metres per second. */
const MOVING_SPEED_MS = 0.5;

/**
 * Mark every sample where the bike was not moving.
 *
 * Two different things put a zero in the power stream and only one of them was
 * being handled. A head unit with auto-pause stops writing records, and the
 * parser invents filler samples flagged `paused`. A phone app records straight
 * through the red light, so the stationary samples are real data and carry no
 * flag at all — but a rider waiting at a light is producing exactly as much
 * power in both cases.
 *
 * Leaving the second kind in dropped average power by 8-13% on the files that
 * had them, which is a difference between rides caused entirely by which device
 * recorded them. Deciding from the distance channel instead makes the rule the
 * same everywhere: if the bike did not move, the sample is not riding.
 */
function restingMask(
  distance: Float64Array,
  time: Float64Array,
  paused: Uint8Array | undefined,
  n: number,
): Uint8Array {
  const resting = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (paused?.[i]) {
      resting[i] = 1;
      continue;
    }
    // Look backwards, so the first sample of a ride is judged by the step into
    // it rather than being dropped for having no predecessor.
    const a = Math.max(0, i - 1);
    const b = i === 0 ? Math.min(1, n - 1) : i;
    const dt = time[b] - time[a];
    const dd = distance[b] - distance[a];
    if (!(dt > 0) || dd / dt <= MOVING_SPEED_MS) resting[i] = 1;
  }
  return resting;
}

/**
 * Drop samples where the rider was not actually riding.
 *
 * This is not a nicety. A real 105 km ride with ~80 minutes of stops reported a
 * mean of 61 W where steady-state physics says ~89 W, purely because a third of
 * the samples were zeros. Every average, and Weighted Power's 30-second window,
 * has to see only real riding.
 */
function compact(
  watts: Float32Array,
  heartrate: Float32Array | undefined,
  resting: Uint8Array,
): { watts: Float32Array; heartrate?: Float32Array } {
  let keep = 0;
  for (let i = 0; i < watts.length; i++) if (!resting[i]) keep++;
  if (keep === watts.length) return { watts, heartrate };
  // A file that is somehow stationary throughout has nothing to average; fall
  // back to the raw arrays rather than returning an empty one.
  if (keep === 0) return { watts, heartrate };

  const w = new Float32Array(keep);
  const h = heartrate ? new Float32Array(keep) : undefined;
  let j = 0;
  for (let i = 0; i < watts.length; i++) {
    if (resting[i]) continue;
    w[j] = watts[i];
    if (h && heartrate) h[j] = heartrate[i];
    j++;
  }
  return { watts: w, heartrate: h };
}

export function computeRideMetrics(input: ComputeMetricsInput): RideMetrics {
  const { watts, time, distance, altitude, heartrate, paused, ftp } = input;
  const n = watts.length;
  const resting = restingMask(distance, time, paused, n);
  const moving = compact(watts, heartrate, resting);

  const durationSeconds = n > 1 ? time[n - 1] - time[0] : 0;

  // Moving time is about the bike moving, not the legs turning — coasting down
  // a descent is still moving. Deriving this from power would silently subtract
  // every descent from the ride.
  let movingSeconds = 0;
  for (let i = 1; i < n; i++) {
    const dd = distance[i] - distance[i - 1];
    const dt = time[i] - time[i - 1];
    if (dt > 0 && dd / dt > MOVING_SPEED_MS) movingSeconds += dt;
  }

  const meanPower = average(moving.watts);
  const wp = weightedPower(moving.watts);
  const meanHr = moving.heartrate ? averageFinitePositive(moving.heartrate) : null;

  // Total work is the sum over every sample — paused samples contribute zero
  // anyway, so this stays correct without compaction.
  let joules = 0;
  for (let i = 0; i < n; i++) joules += watts[i];

  return {
    durationSeconds,
    movingSeconds,
    distanceMeters: n > 1 ? distance[n - 1] - distance[0] : 0,
    elevationGainMeters: totalAscent(altitude),
    meanPower,
    weightedPower: wp,
    intensity: ftp ? intensity(wp, ftp) : 0,
    // Load is scaled by time actually ridden, not by wall-clock elapsed — a
    // long lunch stop must not inflate the training cost of the ride.
    load: ftp ? load(movingSeconds || durationSeconds, wp, ftp) : 0,
    variability: variability(wp, meanPower),
    kilojoules: joules / 1000,
    meanHeartRate: meanHr,
    efficiency: meanHr ? efficiency(wp, meanHr) : null,
    decoupling: moving.heartrate ? decoupling(moving.watts, moving.heartrate) : null,
  };
}

function averageFinitePositive(values: ArrayLike<number>): number | null {
  let s = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i]) && values[i] > 0) {
      s += values[i];
      count++;
    }
  }
  return count > 0 ? s / count : null;
}

/**
 * Half-window for altitude smoothing before summing ascent, in samples (1 Hz),
 * so the full window is 61 seconds.
 *
 * Calibrated against a real barometric file: a 105 km ride over 22 m of total
 * relief, which the head unit reported as 234 m of ascent.
 *
 *   raw sum of deltas            770 m   <- pure sensor noise
 *   Savitzky-Golay halfWindow 15 348 m
 *   Savitzky-Golay halfWindow 30 253 m   <- within 8% of the device
 *   Savitzky-Golay halfWindow 45 206 m
 *
 * Ascent is extraordinarily sensitive to this number, which is exactly why it
 * is pinned here with its evidence rather than passed in by each caller.
 */
export const ASCENT_SMOOTHING_HALF_WINDOW = 30;

/**
 * Total ascent, smoothing internally.
 *
 * Do not reach for the raw summation instead: barometric altitude is quantised
 * to ~0.2 m and dithers constantly, so summing unsmoothed deltas reported 770 m
 * of climbing on a ride whose highest and lowest points differ by 22 m.
 */
export function totalAscent(altitude: ArrayLike<number>): number {
  const smoothed = savitzkyGolay(altitude, ASCENT_SMOOTHING_HALF_WINDOW);
  return elevationGain(smoothed, 0);
}

/**
 * Sum of positive deltas. This is the low-level primitive — it assumes the
 * input is ALREADY smoothed. Prefer `totalAscent`, which handles that for you.
 */
export function elevationGain(altitude: ArrayLike<number>, threshold = 0): number {
  let gain = 0;
  for (let i = 1; i < altitude.length; i++) {
    const d = altitude[i] - altitude[i - 1];
    if (d > threshold) gain += d;
  }
  return gain;
}
