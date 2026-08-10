import type { RideMeta, RideStreams } from "@/lib/analysis/types";

/**
 * A deterministic synthetic ride, used to build and exercise the UI before real
 * files are wired in.
 *
 * Deterministic matters: a seeded generator keeps the route stable across
 * re-renders and makes screenshots comparable. Nothing here touches Math.random
 * or Date.now.
 */

/** mulberry32 — small, fast, good enough for plausible-looking noise. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1-D value noise, so the terrain rolls instead of jittering. */
function valueNoise(rng: () => number, count: number, octaves: number): number[] {
  const out = new Array<number>(count).fill(0);
  let amplitude = 1;
  let wavelength = count;
  for (let o = 0; o < octaves; o++) {
    const knots = Math.max(2, Math.ceil(count / wavelength) + 1);
    const values = Array.from({ length: knots }, () => rng() * 2 - 1);
    for (let i = 0; i < count; i++) {
      const x = i / wavelength;
      const i0 = Math.floor(x);
      const t = x - i0;
      const a = values[i0] ?? 0;
      const b = values[i0 + 1] ?? a;
      // smoothstep keeps the first derivative continuous, which matters here
      // because we differentiate this to get grade
      const s = t * t * (3 - 2 * t);
      out[i] += (a + (b - a) * s) * amplitude;
    }
    amplitude *= 0.5;
    wavelength = Math.max(2, Math.floor(wavelength / 2));
  }
  return out;
}

export interface SyntheticRideOptions {
  seed?: number;
  /** Ride duration in seconds. */
  seconds?: number;
  /** Loop centre. Defaults to the Col de la Madone road above Menton. */
  center?: { lat: number; lng: number };
}

export interface SyntheticRide {
  streams: RideStreams;
  meta: RideMeta;
  name: string;
  startedAt: string;
}

/**
 * Build a rolling loop with a couple of real climbs, plausible speed for the
 * gradient, cadence that drops to zero on fast descents, and heart rate that
 * lags effort the way a real one does.
 */
export function makeSyntheticRide(options: SyntheticRideOptions = {}): SyntheticRide {
  const {
    seed = 20260809,
    seconds = 7200,
    center = { lat: 43.7896, lng: 7.4474 },
  } = options;

  const rng = makeRng(seed);
  const n = seconds;

  const time = new Float64Array(n);
  const distance = new Float64Array(n);
  const altitude = new Float64Array(n);
  const latlng = new Float64Array(n * 2);
  const speed = new Float32Array(n);
  const cadence = new Float32Array(n);
  const heartrate = new Float32Array(n);
  const temperature = new Float32Array(n);

  // Terrain is defined against DISTANCE, not time. Defining it against time and
  // then deriving grade from the previous sample's speed creates a feedback
  // loop: slow -> short run -> steeper apparent grade -> slower still, until
  // speed pins to its clamp and the profile saturates.
  const ROUTE_M = 56_000;
  const KNOTS = 1024;
  const terrainNoise = valueNoise(rng, KNOTS, 5);
  const elevationAt = (metres: number): number => {
    const p = Math.min(1, Math.max(0, metres / ROUTE_M));
    const climb1 = 520 * Math.exp(-(((p - 0.28) / 0.13) ** 2));
    const climb2 = 380 * Math.exp(-(((p - 0.66) / 0.1) ** 2));
    const k = p * (KNOTS - 1);
    const k0 = Math.floor(k);
    const frac = k - k0;
    const rolling =
      (terrainNoise[k0] ?? 0) * (1 - frac) + (terrainNoise[k0 + 1] ?? 0) * frac;
    return 60 + climb1 + climb2 + rolling * 26;
  };

  let cumulative = 0;
  let hr = 96;
  let v = 7;
  let coasting = false;

  for (let i = 0; i < n; i++) {
    time[i] = i;
    altitude[i] = elevationAt(cumulative);

    // Grade over a fixed 40 m of road, looking slightly ahead — the same
    // distance-window logic the real estimator uses.
    const grade = (elevationAt(cumulative + 30) - elevationAt(cumulative - 10)) / 40;

    // Target speed for this gradient, approached with inertia so the rider
    // accelerates and decelerates rather than teleporting between speeds.
    let target: number;
    if (grade > 0) target = Math.max(3.1, 9.4 - grade * 62);
    else target = Math.min(16.5, 9.4 - grade * 46);
    target *= 0.97 + rng() * 0.06;
    v += (target - v) / 12;

    speed[i] = v;
    cumulative += v;
    distance[i] = cumulative;

    // Coasting runs in stretches, with hysteresis: it starts on a descent and
    // keeps going until the road flattens or the rider decides to pedal again.
    // Sampling this per-second instead makes cadence flicker 0<->85 every
    // sample, which is both unphysical and unreadable on a chart.
    if (coasting) {
      if (grade > -0.012 || rng() > 0.995) coasting = false;
    } else if (grade < -0.025 && rng() > 0.97) {
      coasting = true;
    }
    cadence[i] = coasting ? 0 : Math.max(0, Math.round(80 + rng() * 12 - grade * 30));

    // Heart rate: first-order lag toward a target set by gradient and speed.
    const effort = Math.min(1, Math.max(0, 0.35 + grade * 7 + (v - 8) * 0.012));
    const hrTarget = 96 + effort * 78;
    hr += (hrTarget - hr) / 26;
    heartrate[i] = Math.round(hr + (rng() - 0.5) * 2.2);

    // Cools with altitude, warms through the middle of the day.
    temperature[i] = 24 - (altitude[i] - 60) * 0.0062 + Math.sin(i / 2400) * 1.4;
  }

  writeLoopTrack(latlng, distance, center, n);

  return {
    streams: { time, distance, altitude, latlng, speed, cadence, heartrate, temperature },
    meta: { altitudeSource: "barometric", n },
    name: "Col de la Madone loop",
    startedAt: "2026-08-08T07:12:00Z",
  };
}

/**
 * Lay the samples out along a closed loop, spaced by actual distance travelled
 * so the map trace bunches where the rider was slow — which is what makes a
 * route map read as a ride rather than a shape.
 */
function writeLoopTrack(
  latlng: Float64Array,
  distance: Float64Array,
  center: { lat: number; lng: number },
  n: number,
): void {
  const total = distance[n - 1] || 1;
  const latPerM = 1 / 111_320;
  const lngPerM = 1 / (111_320 * Math.cos((center.lat * Math.PI) / 180));

  for (let i = 0; i < n; i++) {
    const t = (distance[i] / total) * Math.PI * 2;
    // A wobbled ellipse reads as a road loop; a clean circle reads as a bug.
    const r = 4200 + 1500 * Math.sin(t * 3) + 700 * Math.cos(t * 5 + 1.2);
    const x = Math.cos(t) * r + 900 * Math.sin(t * 2);
    const y = Math.sin(t) * r * 0.72 + 600 * Math.cos(t * 4);
    latlng[i * 2] = center.lat + y * latPerM;
    latlng[i * 2 + 1] = center.lng + x * lngPerM;
  }
}
