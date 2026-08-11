import { movingAverage, savitzkyGolay } from "./signal";
import type {
  ConfidenceFlag,
  ConfidenceLevel,
  EstimatedPower,
  PowerConfidence,
  RideMeta,
  RideStreams,
  RiderProfile,
} from "./types";

const G = 9.8067;
/** Specific gas constant for dry air, J/(kg·K). */
const R_DRY_AIR = 287.058;
/** ISA sea-level temperature, K, and lapse rate, K/m. */
const ISA_T0 = 288.15;
const ISA_LAPSE = 0.0065;

/**
 * Rotational inertia of two wheels expressed as extra translational mass.
 * Published values for I/r² are hard to pin down; ~1.2 kg is the commonly used
 * approximation for road wheels and only matters during hard accelerations.
 */
const WHEEL_INERTIA_KG = 1.2;

/** Grade beyond this is a GPS artefact, not a road. */
const MAX_GRADE = 0.25;
/** Below this the grade denominator is noise-dominated. */
const MIN_GRADE_SPAN_M = 5;

/**
 * Physical guards against data artefacts.
 *
 * Estimated power is a cubic function of speed and a linear function of
 * acceleration, so a single bad GPS fix does not produce a slightly wrong
 * number — it produces 10,000 W. One such sample distorts the maximum, the
 * power curve, and every peak-power figure derived from them.
 *
 * These are not tuning knobs. They are the boundaries of what a person on a
 * bicycle can do, and a sample outside them is a measurement error.
 */

/** 108 km/h. Faster than this on a road bike is a position glitch. */
const MAX_SPEED_MS = 30;
/**
 * A standing-start sprint reaches roughly 3 m/s²; sustained values above this
 * are differentiation noise, not riding.
 */
const MAX_ACCEL_MS2 = 4;
/**
 * Track sprinters peak near 2,500 W for a second or two. An *estimate* above
 * 2,000 W is an artefact, not an achievement — and this model has no business
 * claiming a sprint it cannot see.
 */
const MAX_PLAUSIBLE_WATTS = 2000;

/** Half-window used to smooth device-reported speed before differentiating. */
const SPEED_SMOOTH_HALF_WINDOW = 2;
/** Wider window for speed integrated from positions — see estimatePower. */
const DERIVED_SPEED_SMOOTH_HALF_WINDOW = 5;

/**
 * Half-window, in seconds, for the central difference that gives acceleration.
 *
 * This is the most consequential constant in the model, for a reason that is
 * easy to miss: over a ride starting and ending at rest, net kinetic work is
 * ZERO. Every acceleration is paid back by a deceleration. So the kinetic term
 * should very nearly cancel over a ride — but negative total power is clamped
 * to zero, which means symmetric noise in acceleration is not symmetric in
 * effect. It is a one-way ratchet that only ever adds watts.
 *
 * The size of that bias therefore depends on how noisy the speed channel is,
 * which is not a property of the rider at all. Measured across real files:
 *
 *   device speed (FIT)   mean |a| 0.10 m/s²   kinetic contribution 35 W
 *   GPS-derived (GPX)    mean |a| 0.14-0.21   kinetic contribution 50-78 W
 *
 * The same rider on the same roads scored 40% higher purely for having
 * recorded on a phone. Differentiating over seven seconds rather than two
 * averages that noise down while still capturing real accelerations, which
 * persist for seconds.
 */
const ACCEL_HALF_WINDOW_S = 3;

/**
 * Widen a boolean mask by `radius` samples in both directions.
 *
 * Used so a pause's influence covers everything the smoothing window can reach,
 * not just the paused samples themselves.
 */
function dilate(mask: Uint8Array | undefined, radius: number): Uint8Array | undefined {
  if (!mask) return undefined;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(mask.length - 1, i + radius);
    for (let j = lo; j <= hi; j++) out[j] = 1;
  }
  return out;
}

/**
 * Air density from altitude, with a temperature correction when the device
 * recorded one.
 *
 * Base is Danek et al.'s fitted exponential, ρ = 1.225·exp(−0.00011856·h).
 * Since ρ ∝ 1/T at a given pressure, we scale by the ratio of ISA temperature
 * at that altitude to the measured temperature.
 */
export function airDensity(altitudeM: number, temperatureC?: number): number {
  const base = 1.225 * Math.exp(-0.00011856 * altitudeM);
  if (temperatureC === undefined || !Number.isFinite(temperatureC)) return base;
  const tActual = temperatureC + 273.15;
  if (tActual <= 0) return base;
  const tIsa = ISA_T0 - ISA_LAPSE * altitudeM;
  return base * (tIsa / tActual);
}

/**
 * Grade as a rise/run ratio, computed over a DISTANCE window.
 *
 * Using a time window instead is the classic bug: at low speed the denominator
 * collapses toward zero and grade spikes to ±infinity. The window is centred and
 * grows outward until it spans `windowM` metres.
 *
 * Expects `altitude` to already be smoothed — see `estimatePower`.
 */
export function gradeFromDistance(
  distance: ArrayLike<number>,
  altitude: ArrayLike<number>,
  windowM = 30,
): Float64Array {
  const n = distance.length;
  const out = new Float64Array(n);
  if (n < 2) return out;

  const half = windowM / 2;
  let lo = 0;
  let hi = 0;

  for (let i = 0; i < n; i++) {
    // Both pointers advance monotonically, so this stays O(n).
    while (lo < i && distance[i] - distance[lo] > half) lo++;
    if (lo > 0 && distance[i] - distance[lo] < half) lo--;
    while (hi < n - 1 && distance[hi] - distance[i] < half) hi++;

    const run = distance[hi] - distance[lo];
    if (run < MIN_GRADE_SPAN_M) {
      // Stopped or crawling — no meaningful gradient to read.
      out[i] = 0;
      continue;
    }
    const g = (altitude[hi] - altitude[lo]) / run;
    out[i] = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, g));
  }
  return out;
}

/** Speed from the distance stream when the device didn't record it directly. */
function deriveSpeed(streams: RideStreams): Float64Array {
  const { time, distance } = streams;
  const n = time.length;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dt = time[b] - time[a];
    v[i] = dt > 0 ? (distance[b] - distance[a]) / dt : 0;
  }
  return v;
}

export interface EstimatePowerOptions {
  /**
   * Headwind component along the direction of travel, m/s. Positive is a
   * headwind. Left at zero unless historical weather is wired in — it is the
   * second largest error source and is irreducible from the trace alone.
   */
  headwind?: number;
  /** Distance window for grade, metres. */
  gradeWindowM?: number;
}

/**
 * Estimate power from the physics of riding a bike.
 *
 *   P = (1/η)·[ m·g·(sinθ + Crr·cosθ) + ½·ρ·CdA·(v+w)² + m_eff·a ]·v
 *
 * Two corrections make this materially better than a speed/elevation-only
 * estimator: grade is smoothed properly before differentiation, and cadence
 * gates coasting to zero rather than attributing phantom watts to a descent.
 */
export function estimatePower(
  streams: RideStreams,
  meta: RideMeta,
  profile: RiderProfile,
  options: EstimatePowerOptions = {},
): EstimatedPower {
  const { headwind = 0, gradeWindowM = 30 } = options;
  const n = meta.n;
  const watts = new Float32Array(n);
  if (n === 0) {
    return { watts, confidence: scoreConfidence(streams, meta, watts, 0) };
  }

  const totalMass = profile.riderKg + profile.bikeKg;
  const effectiveMass = totalMass + WHEEL_INERTIA_KG;

  // Smooth elevation FIRST, then differentiate. Reversing these is the single
  // biggest accuracy mistake available here.
  const altitude = savitzkyGolay(streams.altitude, 7);
  const grade = gradeFromDistance(streams.distance, altitude, gradeWindowM);

  // Speed gets a light smooth too, otherwise dv/dt is pure noise and the
  // kinetic term swamps everything else.
  //
  // Speed integrated from positions or a distance channel is far noisier than
  // speed a device measured, and irregular sampling makes it staircase: flat
  // between fixes, then a step. Differentiated, that reads as a hard
  // acceleration at every fix. One real file showed a variability index of 1.72
  // over four steady hours purely from this. Derived speed therefore gets a
  // wider window.
  const rawSpeed = streams.speed ?? deriveSpeed(streams);
  const smoothHalfWindow = streams.speedIsDerived
    ? DERIVED_SPEED_SMOOTH_HALF_WINDOW
    : SPEED_SMOOTH_HALF_WINDOW;
  const speed = movingAverage(rawSpeed, smoothHalfWindow);

  const cadence = streams.cadence;

  // Dilate the pause mask before using it to gate the kinetic term.
  //
  // Speed is smoothed over a +/-2 window and acceleration reads +/-1 around a
  // sample, so the zeros inserted for a pause contaminate three samples past
  // each edge. Guarding only the immediate neighbours leaves a ~1,200 W spike
  // sitting just outside the pause — the exact artefact this is here to remove.
  const paused = dilate(streams.paused, smoothHalfWindow + ACCEL_HALF_WINDOW_S);

  // Count affected SAMPLES, not clamp events: one bad fix trips the speed,
  // acceleration and power guards at once, and counting each would make a
  // single glitch look like a systematically broken trace.
  const affected = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const v = Math.min(speed[i], MAX_SPEED_MS);
    if (speed[i] > MAX_SPEED_MS) affected[i] = 1;
    if (!(v > 0.5)) {
      // Stationary. Not coasting — genuinely stopped.
      watts[i] = 0;
      continue;
    }

    // Cadence of zero means the legs are not driving the bike. Strava's
    // estimator has no cadence channel; this is the cheapest real accuracy win.
    if (cadence && cadence[i] === 0) {
      watts[i] = 0;
      continue;
    }

    const theta = Math.atan(grade[i]);
    const rho = airDensity(altitude[i], streams.temperature?.[i]);

    const fGravity = totalMass * G * Math.sin(theta);
    const fRolling = totalMass * G * profile.crr * Math.cos(theta);

    // Sign the drag term so a tailwind faster than the rider pushes rather
    // than resists.
    const vAir = v + headwind;
    const fDrag = 0.5 * profile.cda * rho * vAir * Math.abs(vAir);

    const prev = Math.max(0, i - ACCEL_HALF_WINDOW_S);
    const next = Math.min(n - 1, i + ACCEL_HALF_WINDOW_S);

    // Acceleration must not be measured across a recording pause. Speed there
    // is a zero WE inserted, so resuming looks like 0 -> 8 m/s in one second:
    // ~900 N of phantom force and several thousand watts, at the start of every
    // segment after every stop.
    const crossesPause =
      paused !== undefined && (paused[prev] === 1 || paused[next] === 1 || paused[i] === 1);

    let fKinetic = 0;
    if (!crossesPause) {
      const dt = streams.time[next] - streams.time[prev];
      let accel = dt > 0 ? (speed[next] - speed[prev]) / dt : 0;
      if (accel > MAX_ACCEL_MS2 || accel < -MAX_ACCEL_MS2) {
        accel = Math.max(-MAX_ACCEL_MS2, Math.min(MAX_ACCEL_MS2, accel));
        affected[i] = 1;
      }
      fKinetic = effectiveMass * accel;
    }

    const pWheel = (fGravity + fRolling + fDrag + fKinetic) * v;
    const pLegs = pWheel / profile.drivetrainEfficiency;

    // Negative power is braking or coasting, not a contribution. Clamping here
    // keeps it out of averages, the curve, and Weighted Power.
    if (pLegs > MAX_PLAUSIBLE_WATTS) {
      watts[i] = MAX_PLAUSIBLE_WATTS;
      affected[i] = 1;
    } else {
      watts[i] = pLegs > 0 ? pLegs : 0;
    }
  }

  let artefacts = 0;
  for (let i = 0; i < n; i++) if (affected[i]) artefacts++;

  return { watts, confidence: scoreConfidence(streams, meta, watts, artefacts) };
}

/**
 * Grade the trustworthiness of an estimate.
 *
 * Wind and drafting cannot be recovered from a GPS trace, so rather than
 * printing a fake-precise number we surface why a ride might be wrong. A bunch
 * ride can be off by 90%; the user should be told that, not left to discover it.
 */
function scoreConfidence(
  streams: RideStreams,
  meta: RideMeta,
  watts: Float32Array,
  artefacts: number,
): PowerConfidence {
  const flags: ConfidenceFlag[] = [];

  // A handful of clamped samples is normal GPS noise. A sustained rate of them
  // means the position trace is unreliable and everything derived from speed
  // should be treated with suspicion.
  if (meta.n > 0 && artefacts / meta.n > 0.005) flags.push("glitchy-gps");

  if (meta.altitudeSource !== "barometric") flags.push("gps-altitude");
  if (!streams.cadence) flags.push("no-cadence");

  const n = meta.n;
  if (n > 0) {
    // Long stretches of high speed on flat ground are the drafting signature:
    // the model attributes the speed entirely to the rider.
    const speed = streams.speed;
    if (speed) {
      let fast = 0;
      for (let i = 0; i < n; i++) if (speed[i] > 11) fast++;
      if (fast / n > 0.25) flags.push("sustained-high-speed");
    }

    // If HR and estimated power disagree in shape, one of them is wrong — and
    // it is not usually the heart rate monitor.
    const hr = streams.heartrate;
    if (hr) {
      const r = correlation(watts, hr);
      if (Number.isFinite(r) && r < 0.3) flags.push("hr-power-decoupled");

      // Shape agreement is not enough — the LEVEL has to be plausible too.
      //
      // Efficiency factor is conventionally weighted power over average heart
      // rate. The bounds below are deliberately wide: EF runs 1.2-2.5 for a
      // trained cyclist, but that describes fitness, not physics. A heavier or
      // less-trained rider genuinely sits under it, and flagging them would be
      // the app calling a correct reading wrong. Only values outside what any
      // rider could produce point at a mis-scaled model — in practice a rider
      // mass or drag area set far too low.
      //
      // Both terms skip paused filler, or a ride with long stops looks
      // mis-scaled purely because of zeros we inserted ourselves.
      const meanHr = meanOf(hr, streams.paused);
      const weighted = weightedPowerOf(watts, streams.paused);
      if (meanHr > 110 && weighted > 0) {
        const ef = weighted / meanHr;
        if (ef < 0.6 || ef > 4) flags.push("hr-power-implausible");
      }
    }
  }

  const level = levelFor(flags);
  return { level, flags, summary: summarise(level, flags) };
}

function levelFor(flags: ConfidenceFlag[]): ConfidenceLevel {
  const heavy =
    flags.includes("gps-altitude") ||
    flags.includes("hr-power-decoupled") ||
    flags.includes("hr-power-implausible");
  if (flags.length === 0) return "high";
  if (flags.length >= 3) return "unusable";
  if (heavy) return "low";
  return "moderate";
}

const FLAG_TEXT: Record<ConfidenceFlag, string> = {
  "gps-altitude":
    "elevation came from GPS rather than a barometer, which roughly quintuples grade error",
  "no-cadence": "no cadence recorded, so coasting can't be separated from pedalling",
  "hr-power-decoupled":
    "heart rate doesn't track the estimate, which usually means wind or drafting",
  "hr-power-implausible":
    "the watts per heartbeat fall outside what any rider produces, which points at the model being mis-scaled rather than at the ride — check rider weight and riding position in settings",
  "glitchy-gps":
    "the position trace jumps around, so speed and therefore power are unreliable in places",
  "sustained-high-speed":
    "long stretches of high speed on flat ground, typical of riding in a group",
  "sparse-sampling": "the device recorded too infrequently to model acceleration",
};

function summarise(level: ConfidenceLevel, flags: ConfidenceFlag[]): string {
  if (level === "high") {
    return "Barometric elevation and cadence both present — this estimate is as good as it gets without a power meter.";
  }
  const reasons = flags.map((f) => FLAG_TEXT[f]);
  const joined =
    reasons.length === 1
      ? reasons[0]
      : `${reasons.slice(0, -1).join("; ")}; and ${reasons.at(-1)}`;
  return `Treat with caution — ${joined}.`;
}

/**
 * Weighted power over the moving samples only.
 *
 * Duplicated from metrics.ts rather than imported: metrics depends on the power
 * estimate, so reaching the other way would be a cycle. It is a handful of
 * lines and the definition is fixed.
 */
function weightedPowerOf(watts: ArrayLike<number>, paused?: Uint8Array): number {
  const moving: number[] = [];
  for (let i = 0; i < watts.length; i++) {
    if (!paused?.[i]) moving.push(watts[i]);
  }
  if (moving.length === 0) return 0;

  const window = 30;
  let sum = 0;
  let total = 0;
  for (let i = 0; i < moving.length; i++) {
    sum += moving[i];
    if (i >= window) sum -= moving[i - window];
    const mean = sum / window;
    total += mean ** 4;
  }
  return (total / moving.length) ** 0.25;
}

/** Mean over finite, positive samples, skipping paused filler. */
function meanOf(values: ArrayLike<number>, paused?: Uint8Array): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (paused?.[i]) continue;
    if (Number.isFinite(values[i]) && values[i] > 0) {
      sum += values[i];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Pearson correlation, ignoring pairs where either side is not finite. */
function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let count = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    sa += a[i];
    sb += b[i];
    count++;
  }
  if (count < 2) return NaN;
  const ma = sa / count;
  const mb = sb / count;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}
