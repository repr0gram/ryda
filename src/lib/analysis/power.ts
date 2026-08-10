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
    return { watts, confidence: scoreConfidence(streams, meta, watts) };
  }

  const totalMass = profile.riderKg + profile.bikeKg;
  const effectiveMass = totalMass + WHEEL_INERTIA_KG;

  // Smooth elevation FIRST, then differentiate. Reversing these is the single
  // biggest accuracy mistake available here.
  const altitude = savitzkyGolay(streams.altitude, 7);
  const grade = gradeFromDistance(streams.distance, altitude, gradeWindowM);

  // Speed gets a light smooth too, otherwise dv/dt is pure noise and the
  // kinetic term swamps everything else.
  const rawSpeed = streams.speed ?? deriveSpeed(streams);
  const speed = movingAverage(rawSpeed, 2);

  const cadence = streams.cadence;

  for (let i = 0; i < n; i++) {
    const v = speed[i];
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

    const prev = Math.max(0, i - 1);
    const next = Math.min(n - 1, i + 1);
    const dt = streams.time[next] - streams.time[prev];
    const accel = dt > 0 ? (speed[next] - speed[prev]) / dt : 0;
    const fKinetic = effectiveMass * accel;

    const pWheel = (fGravity + fRolling + fDrag + fKinetic) * v;
    const pLegs = pWheel / profile.drivetrainEfficiency;

    // Negative power is braking or coasting, not a contribution. Clamping here
    // keeps it out of averages, the curve, and Weighted Power.
    watts[i] = pLegs > 0 ? pLegs : 0;
  }

  return { watts, confidence: scoreConfidence(streams, meta, watts) };
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
): PowerConfidence {
  const flags: ConfidenceFlag[] = [];

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
    }
  }

  const level = levelFor(flags);
  return { level, flags, summary: summarise(level, flags) };
}

function levelFor(flags: ConfidenceFlag[]): ConfidenceLevel {
  const heavy =
    flags.includes("gps-altitude") || flags.includes("hr-power-decoupled");
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
