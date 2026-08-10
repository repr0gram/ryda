import { describe, expect, test } from "vitest";
import { airDensity, estimatePower, gradeFromDistance } from "./power";
import { savitzkyGolay } from "./signal";
import type { RideMeta, RideStreams, RiderProfile } from "./types";

const PROFILE: RiderProfile = {
  riderKg: 75,
  bikeKg: 9,
  cda: 0.34,
  crr: 0.0045,
  drivetrainEfficiency: 0.975,
};

/** A synthetic ride at constant speed and constant grade. */
function syntheticRide(opts: {
  seconds: number;
  speed: number;
  grade: number;
  cadence?: number | ((i: number) => number);
}): { streams: RideStreams; meta: RideMeta } {
  const { seconds, speed, grade } = opts;
  const time = new Float64Array(seconds);
  const distance = new Float64Array(seconds);
  const altitude = new Float64Array(seconds);
  const speedArr = new Float32Array(seconds);
  const cadence =
    opts.cadence === undefined ? undefined : new Float32Array(seconds);

  for (let i = 0; i < seconds; i++) {
    time[i] = i;
    distance[i] = i * speed;
    altitude[i] = distance[i] * grade;
    speedArr[i] = speed;
    if (cadence) {
      cadence[i] =
        typeof opts.cadence === "function" ? opts.cadence(i) : (opts.cadence as number);
    }
  }
  return {
    streams: { time, distance, altitude, speed: speedArr, cadence },
    meta: { altitudeSource: "barometric", n: seconds },
  };
}

/** Mean of a slice, avoiding filter edge effects at the ends. */
function midMean(a: Float32Array): number {
  const lo = Math.floor(a.length * 0.25);
  const hi = Math.floor(a.length * 0.75);
  let s = 0;
  for (let i = lo; i < hi; i++) s += a[i];
  return s / (hi - lo);
}

describe("savitzkyGolay", () => {
  test("preserves a linear ramp exactly (quadratic filter, degree <= 2)", () => {
    const ramp = Array.from({ length: 60 }, (_, i) => 3 * i + 7);
    const out = savitzkyGolay(ramp, 5);
    for (let i = 0; i < ramp.length; i++) {
      expect(out[i]).toBeCloseTo(ramp[i], 6);
    }
  });

  test("suppresses alternating noise while holding the mean", () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 ? 10 : -10));
    const out = savitzkyGolay(noisy, 5);
    const mid = out.slice(20, 180);
    for (const v of mid) expect(Math.abs(v - 100)).toBeLessThan(6);
  });
});

describe("gradeFromDistance", () => {
  test("recovers a known constant grade", () => {
    const n = 400;
    const distance = new Float64Array(n);
    const altitude = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      distance[i] = i * 5;
      altitude[i] = distance[i] * 0.08;
    }
    const g = gradeFromDistance(distance, altitude, 30);
    for (let i = 20; i < n - 20; i++) expect(g[i]).toBeCloseTo(0.08, 6);
  });

  test("returns zero rather than exploding when the rider is stopped", () => {
    // Distance does not advance, so a time-window grade would divide by ~0.
    const n = 120;
    const distance = new Float64Array(n);
    const altitude = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      distance[i] = i < 60 ? i * 4 : 60 * 4;
      altitude[i] = i < 60 ? i * 4 * 0.05 : 60 * 4 * 0.05;
    }
    const g = gradeFromDistance(distance, altitude, 30);
    for (const v of g) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(0.25);
    }
  });

  test("clamps GPS spikes to the physical maximum", () => {
    const n = 100;
    const distance = new Float64Array(n);
    const altitude = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      distance[i] = i * 5;
      altitude[i] = i === 50 ? 400 : 0; // absurd single-sample spike
    }
    const g = gradeFromDistance(distance, altitude, 30);
    for (const v of g) expect(Math.abs(v)).toBeLessThanOrEqual(0.25);
  });
});

describe("airDensity", () => {
  test("matches the published sea-level value", () => {
    expect(airDensity(0)).toBeCloseTo(1.225, 3);
  });

  test("falls with altitude", () => {
    expect(airDensity(2000)).toBeLessThan(airDensity(0));
    expect(airDensity(2000)).toBeCloseTo(1.225 * Math.exp(-0.00011856 * 2000), 6);
  });

  test("warm air is thinner than cold air at the same altitude", () => {
    expect(airDensity(0, 35)).toBeLessThan(airDensity(0, 0));
  });
});

describe("estimatePower", () => {
  test("matches a hand-computed steady climb", () => {
    // 84 kg total, 5% grade, 5 m/s, no wind, no acceleration.
    //   theta    = atan(0.05)      -> sin 0.0499376, cos 0.9987523
    //   gravity  = 84*9.8067*sin   = 41.137 N
    //   rolling  = 84*9.8067*Crr*cos = 3.702 N
    //   drag     = 0.5*0.34*rho*25  ~ 5.19 N   (rho ~1.222 over 0-50 m)
    //   P_wheel  = (41.137+3.702+5.19)*5 = 250.1 W
    //   P_legs   = 250.1 / 0.975        = 256.6 W
    const { streams, meta } = syntheticRide({
      seconds: 200,
      speed: 5,
      grade: 0.05,
      cadence: 85,
    });
    const { watts } = estimatePower(streams, meta, PROFILE);
    expect(midMean(watts)).toBeGreaterThan(254);
    expect(midMean(watts)).toBeLessThan(259);
  });

  test("scales sensibly with mass on a climb", () => {
    const ride = syntheticRide({ seconds: 200, speed: 5, grade: 0.05, cadence: 85 });
    const light = estimatePower(ride.streams, ride.meta, PROFILE);
    const heavy = estimatePower(ride.streams, ride.meta, {
      ...PROFILE,
      riderKg: 95,
    });
    expect(midMean(heavy.watts)).toBeGreaterThan(midMean(light.watts));
  });

  test("cadence of zero forces coasting to zero watts", () => {
    // Descending with the legs stopped: the model must not credit gravity.
    const { streams, meta } = syntheticRide({
      seconds: 200,
      speed: 12,
      grade: 0.06,
      cadence: (i) => (i >= 80 && i < 140 ? 0 : 90),
    });
    const { watts } = estimatePower(streams, meta, PROFILE);
    for (let i = 85; i < 135; i++) expect(watts[i]).toBe(0);
    // and the pedalling sections are still producing power
    expect(watts[40]).toBeGreaterThan(0);
  });

  test("never returns negative power on a descent", () => {
    const { streams, meta } = syntheticRide({ seconds: 200, speed: 14, grade: -0.08 });
    const { watts } = estimatePower(streams, meta, PROFILE);
    for (const w of watts) expect(w).toBeGreaterThanOrEqual(0);
  });

  test("a stationary rider produces no power", () => {
    const n = 60;
    const streams: RideStreams = {
      time: Float64Array.from({ length: n }, (_, i) => i),
      distance: new Float64Array(n),
      altitude: new Float64Array(n),
      speed: new Float32Array(n),
    };
    const { watts } = estimatePower(streams, { altitudeSource: "barometric", n }, PROFILE);
    for (const w of watts) expect(w).toBe(0);
  });

  test("energy balance: mean power x time is consistent with total work", () => {
    const { streams, meta } = syntheticRide({
      seconds: 600,
      speed: 6,
      grade: 0.03,
      cadence: 85,
    });
    const { watts } = estimatePower(streams, meta, PROFILE);
    let joules = 0;
    for (const w of watts) joules += w; // 1 Hz, so 1 s per sample
    const kj = joules / 1000;
    const meanW = joules / watts.length;
    expect(kj).toBeCloseTo((meanW * watts.length) / 1000, 6);
    // A 10 min tempo climb should land in a believable kJ range.
    expect(kj).toBeGreaterThan(60);
    expect(kj).toBeLessThan(160);
  });

  test("confidence is high with barometric altitude and cadence", () => {
    const { streams, meta } = syntheticRide({
      seconds: 300,
      speed: 6,
      grade: 0.04,
      cadence: 85,
    });
    const { confidence } = estimatePower(streams, meta, PROFILE);
    expect(confidence.level).toBe("high");
    expect(confidence.flags).toEqual([]);
  });

  test("confidence degrades without a barometer and without cadence", () => {
    const { streams, meta } = syntheticRide({ seconds: 300, speed: 6, grade: 0.04 });
    const { confidence } = estimatePower(
      streams,
      { ...meta, altitudeSource: "gps" },
      PROFILE,
    );
    expect(confidence.flags).toContain("gps-altitude");
    expect(confidence.flags).toContain("no-cadence");
    expect(confidence.level).not.toBe("high");
    expect(confidence.summary).toMatch(/caution/i);
  });
});
