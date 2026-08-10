import { elementwiseMax } from "./signal";

/**
 * Mean-maximal power curve: the best average power sustainable for every
 * duration.
 *
 * Implementation notes
 * --------------------
 * Prefix sums make any window's total work a single subtraction, so each
 * duration costs O(n). We evaluate ~90 log-spaced durations rather than all n,
 * then backfill and enforce monotonicity.
 *
 * GoldenCheetah additionally prunes candidate windows by total energy, but that
 * matters at desktop-archive scale; here a 5 h ride is ~90 x 18,000 = 1.6M
 * subtractions, a few milliseconds. The optimisation that actually matters is
 * architectural: cache this array per activity and aggregate a season with an
 * element-wise max, never by recomputing from raw streams.
 */

/** Durations in seconds, log-spaced from 1 s to 6 h. */
export const CURVE_DURATIONS: number[] = buildDurations();

function buildDurations(): number[] {
  const out: number[] = [];
  let t = 1;
  while (t <= 21600) {
    out.push(t);
    if (t < 120) t += 1;
    else if (t < 600) t += 5;
    else if (t < 1200) t += 15;
    else if (t < 3600) t += 60;
    else if (t < 7200) t += 300;
    else t += 900;
  }
  return out;
}

export interface PowerCurve {
  /** Durations in seconds; parallel to `watts`. */
  durations: Int32Array;
  /** Best mean power sustained for the matching duration. */
  watts: Float32Array;
  /** Sample index where each best effort started, for "show me on the ride". */
  offsets: Int32Array;
}

/**
 * Build the curve for a single activity. Assumes a uniform 1 Hz grid, so one
 * sample is one second.
 */
export function buildPowerCurve(
  watts: ArrayLike<number>,
  durations: number[] = CURVE_DURATIONS,
): PowerCurve {
  const n = watts.length;
  const outWatts = new Float32Array(durations.length);
  const outOffsets = new Int32Array(durations.length).fill(-1);

  // prefix[i] = total work in the first i samples.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + watts[i];

  for (let d = 0; d < durations.length; d++) {
    const t = durations[d];
    if (t > n) break; // durations ascend, so nothing longer can fit either
    let best = -Infinity;
    let bestAt = -1;
    for (let i = 0; i + t <= n; i++) {
      const energy = prefix[i + t] - prefix[i];
      if (energy > best) {
        best = energy;
        bestAt = i;
      }
    }
    if (bestAt >= 0) {
      outWatts[d] = best / t;
      outOffsets[d] = bestAt;
    }
  }

  enforceMonotonic(outWatts);
  return {
    durations: Int32Array.from(durations),
    watts: outWatts,
    offsets: outOffsets,
  };
}

/**
 * A best-effort curve can only decrease with duration. A reverse running max
 * enforces that and cleans up backfill artefacts in one pass.
 */
function enforceMonotonic(watts: Float32Array): void {
  let running = 0;
  for (let i = watts.length - 1; i >= 0; i--) {
    if (watts[i] < running) watts[i] = running;
    else running = watts[i];
  }
}

/** Aggregate cached per-activity curves into a season/all-time envelope. */
export function aggregateCurves(curves: PowerCurve[]): PowerCurve | null {
  if (curves.length === 0) return null;
  let watts = curves[0].watts;
  for (let i = 1; i < curves.length; i++) {
    watts = elementwiseMax(watts, curves[i].watts);
  }
  return {
    durations: curves[0].durations,
    watts,
    offsets: new Int32Array(watts.length).fill(-1),
  };
}

/** Best mean power for a specific duration, interpolating between curve points. */
export function powerAt(curve: PowerCurve, seconds: number): number {
  const { durations, watts } = curve;
  if (durations.length === 0) return 0;
  if (seconds <= durations[0]) return watts[0];
  for (let i = 1; i < durations.length; i++) {
    if (durations[i] >= seconds) {
      const t0 = durations[i - 1];
      const t1 = durations[i];
      const f = t1 === t0 ? 0 : (seconds - t0) / (t1 - t0);
      return watts[i - 1] + f * (watts[i] - watts[i - 1]);
    }
  }
  return watts[watts.length - 1];
}

export interface CriticalPowerFit {
  /** Asymptotic sustainable power, watts. */
  cp: number;
  /** Work capacity above CP, joules. Typically ~20 kJ. */
  wPrime: number;
  /** Coefficient of determination for the linear fit. */
  r2: number;
  /** How many curve points the fit used. */
  points: number;
}

/**
 * Two-parameter critical power model, fitted in its linear form:
 *
 *   P(t) = W' * (1/t) + CP
 *
 * so ordinary least squares on (1/t, P) gives W' as the slope and CP as the
 * intercept — no optimiser needed.
 *
 * Restricted to 2-15 minute efforts on purpose. The 2-parameter model is only
 * valid in the severe-intensity domain; feeding it 5-second sprints or 3-hour
 * endurance rides produces a confident, meaningless answer.
 */
export function fitCriticalPower(
  curve: PowerCurve,
  minSeconds = 120,
  maxSeconds = 900,
): CriticalPowerFit | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < curve.durations.length; i++) {
    const t = curve.durations[i];
    if (t < minSeconds || t > maxSeconds) continue;
    const p = curve.watts[i];
    if (!(p > 0)) continue;
    xs.push(1 / t);
    ys.push(p);
  }
  if (xs.length < 3) return null;

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  if (sxx === 0) return null;

  const wPrime = sxy / sxx;
  const cp = meanY - wPrime * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = wPrime * xs[i] + cp;
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { cp, wPrime, r2, points: n };
}

export interface FtpEstimate {
  watts: number;
  method: "20min" | "critical-power" | "60min";
  /** Human-readable caveat shown next to the number. */
  note: string;
}

/**
 * Estimate FTP, preferring the 20-minute convention and cross-checking with CP.
 *
 * The 0.95 factor assumes a fresh, isolated, all-out 20-minute effort. Applied
 * to the best 20 minutes of an arbitrary ride it under-reads for riders who
 * never do such an effort — which is most people. We say so rather than
 * presenting the number as measured.
 */
export function estimateFtp(curve: PowerCurve): FtpEstimate | null {
  const best20 = powerAt(curve, 1200);
  const best60 = powerAt(curve, 3600);

  if (best20 > 0) {
    return {
      watts: 0.95 * best20,
      method: "20min",
      note:
        "95% of your best 20 minutes. Accurate only if that effort was a fresh, " +
        "all-out one — otherwise treat it as a floor.",
    };
  }
  const fit = fitCriticalPower(curve);
  if (fit && fit.r2 > 0.9) {
    return {
      watts: fit.cp,
      method: "critical-power",
      note: `Critical power fit across ${fit.points} efforts (R² ${fit.r2.toFixed(2)}). Not the same quantity as FTP, but close in practice.`,
    };
  }
  if (best60 > 0) {
    return {
      watts: best60,
      method: "60min",
      note: "Your best hour. A true floor — almost nobody rides a genuine 60-minute maximum.",
    };
  }
  return null;
}
