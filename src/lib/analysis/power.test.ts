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

  test("freewheeling is detected from physics, with no cadence sensor", () => {
    // A bike rolling on the flat with nobody pedalling loses speed at exactly
    // resistive force over mass. Reproduce that deceleration and the model has
    // to conclude the legs have stopped — the whole point being that it reaches
    // that conclusion without a cadence channel, which most files lack.
    const seconds = 160;
    const time = new Float64Array(seconds);
    const distance = new Float64Array(seconds);
    const altitude = new Float64Array(seconds);
    const speed = new Float32Array(seconds);

    const mass = PROFILE.riderKg + PROFILE.bikeKg + 1.2;
    let v = 10;
    for (let i = 0; i < seconds; i++) {
      time[i] = i;
      speed[i] = v;
      distance[i] = i === 0 ? 0 : distance[i - 1] + v;
      // Pedal for the first 100 s at a steady 10 m/s, then stop pedalling. The
      // extra 5% is a rider brushing the brakes, which keeps the sample off the
      // exact zero-residual boundary where float comparison decides nothing.
      if (i >= 100) {
        const drag = 0.5 * PROFILE.cda * 1.225 * v * v;
        const rolling = (PROFILE.riderKg + PROFILE.bikeKg) * 9.8067 * PROFILE.crr;
        v -= (1.05 * (drag + rolling)) / mass;
      }
    }
    const meta: RideMeta = { altitudeSource: "barometric", n: seconds };
    const { watts } = estimatePower({ time, distance, altitude, speed }, meta, PROFILE);

    // Allow the mask's clean-up window to settle either side of the transition.
    for (let i = 115; i < 150; i++) expect(watts[i]).toBe(0);
    expect(watts[50]).toBeGreaterThan(0);
  });

  test("a cadence dropout does not zero power when the bike holds speed", () => {
    // A cadence sensor that drops out reports zero while the rider pedals on.
    // Believing it deleted 19% of a real ride's mean power, and only on the
    // rides that happened to have a sensor paired. Physics outranks the channel:
    // a bike cannot hold 8 m/s on a 2% climb with the legs stopped.
    const { streams, meta } = syntheticRide({
      seconds: 200,
      speed: 8,
      grade: 0.02,
      cadence: (i) => (i >= 80 && i < 140 ? 0 : 90),
    });
    const { watts } = estimatePower(streams, meta, PROFILE);
    for (let i = 90; i < 130; i++) expect(watts[i]).toBeGreaterThan(0);
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

  test("a GPS speed glitch cannot produce a five-figure wattage", () => {
    // Drag scales with v^3, so one bad fix reading 120 m/s is ~350 kW.
    // Ride length matters here: smoothing spreads one glitch across a few
    // samples, which is a rounding error over an hour but a sixth of a short
    // ride. An hour is the realistic case.
    const { streams, meta } = syntheticRide({
      seconds: 3600,
      speed: 8,
      grade: 0,
      cadence: 85,
    });
    streams.speed![1800] = 120;
    const { watts, confidence } = estimatePower(streams, meta, PROFILE);
    for (const w of watts) expect(w).toBeLessThanOrEqual(2000);
    // An isolated fix is noise, not a broken trace.
    expect(confidence.flags).not.toContain("glitchy-gps");
  });

  test("resuming after a pause does not invent a sprint", () => {
    // The spike this guards against was self-inflicted: normalising inserts a
    // zero for paused time, so resuming reads as 0 -> 9 m/s in one second —
    // roughly 900 N of phantom force, thousands of watts, after every stop.
    const { streams, meta } = syntheticRide({
      seconds: 400,
      speed: 9,
      grade: 0,
      cadence: 85,
    });
    const paused = new Uint8Array(meta.n);
    for (let i = 150; i < 250; i++) {
      paused[i] = 1;
      streams.speed![i] = 0;
      streams.cadence![i] = 0;
    }
    streams.paused = paused;

    const { watts } = estimatePower(streams, meta, PROFILE);
    const steady = watts[80];
    // Every sample around the resume must stay near the steady-state value.
    for (let i = 248; i <= 256; i++) {
      expect(watts[i]).toBeLessThan(steady * 2.5);
    }
  });

  test("a persistently jumpy trace is flagged rather than silently clamped", () => {
    const { streams, meta } = syntheticRide({
      seconds: 600,
      speed: 8,
      grade: 0,
      cadence: 85,
    });
    for (let i = 0; i < meta.n; i += 40) streams.speed![i] = 90;
    const { confidence } = estimatePower(streams, meta, PROFILE);
    expect(confidence.flags).toContain("glitchy-gps");
    expect(confidence.level).not.toBe("high");
  });

  test("speed-channel noise does not inflate power", () => {
    // Two identical rides, one with a noisy speed channel. Because net kinetic
    // work over a ride is zero but negative power is clamped away, symmetric
    // noise is a one-way ratchet — it can only add watts. That made the same
    // rider on the same roads score ~40% higher for recording on a phone
    // instead of a head unit.
    const clean = syntheticRide({ seconds: 1800, speed: 7, grade: 0, cadence: 85 });
    const noisy = syntheticRide({ seconds: 1800, speed: 7, grade: 0, cadence: 85 });

    // Deterministic zero-mean jitter, so the average speed is unchanged.
    for (let i = 0; i < noisy.meta.n; i++) {
      noisy.streams.speed![i] = 7 + (i % 2 === 0 ? 0.6 : -0.6);
    }

    const a = estimatePower(clean.streams, clean.meta, PROFILE);
    const b = estimatePower(noisy.streams, noisy.meta, PROFILE);
    expect(midMean(b.watts)).toBeLessThan(midMean(a.watts) * 1.15);
  });

  test("flags an implausible watts-per-heartbeat even when the shape tracks", () => {
    // A real ride averaged 98 W at 159 bpm (~0.6 W/bpm) and was still being
    // reported as high confidence, because only the correlation was checked.
    // Shape agreement is not the same as a believable level.
    const { streams, meta } = syntheticRide({
      seconds: 600,
      speed: 4,
      grade: 0,
      cadence: 80,
    });
    const hr = new Float32Array(meta.n);
    const { watts } = estimatePower(streams, meta, PROFILE);
    for (let i = 0; i < meta.n; i++) {
      // Track power's shape, but pinned far too high for the wattage.
      hr[i] = 158 + (watts[i] - 60) * 0.01;
    }
    const withHr = { ...streams, heartrate: hr };
    const { confidence } = estimatePower(withHr, meta, PROFILE);
    expect(confidence.flags).toContain("hr-power-implausible");
    expect(confidence.level).not.toBe("high");
    expect(confidence.summary).toMatch(/weight|position/i);
  });

  test("accepts a believable watts-per-heartbeat", () => {
    const { streams, meta } = syntheticRide({
      seconds: 600,
      speed: 8,
      grade: 0.04,
      cadence: 85,
    });
    const { watts } = estimatePower(streams, meta, PROFILE);
    const hr = new Float32Array(meta.n);
    for (let i = 0; i < meta.n; i++) hr[i] = 100 + watts[i] * 0.18;
    const { confidence } = estimatePower({ ...streams, heartrate: hr }, meta, PROFILE);
    expect(confidence.flags).not.toContain("hr-power-implausible");
  });

  test("confidence degrades without a barometer", () => {
    const { streams, meta } = syntheticRide({ seconds: 300, speed: 6, grade: 0.04 });
    const { confidence } = estimatePower(
      streams,
      { ...meta, altitudeSource: "gps" },
      PROFILE,
    );
    expect(confidence.flags).toContain("gps-altitude");
    expect(confidence.level).not.toBe("high");
    expect(confidence.summary).toMatch(/caution/i);
  });

  test("a missing cadence sensor is no longer held against a ride", () => {
    // Coasting is inferred from force balance now, so whether a sensor happened
    // to be paired says nothing about how good the estimate is. Flagging it
    // would put a warning on almost every file for a reason that stopped being
    // true.
    const { streams, meta } = syntheticRide({ seconds: 300, speed: 6, grade: 0.02 });
    const withCadence = syntheticRide({ seconds: 300, speed: 6, grade: 0.02, cadence: 85 });
    expect(estimatePower(streams, meta, PROFILE).confidence.level).toBe(
      estimatePower(withCadence.streams, withCadence.meta, PROFILE).confidence.level,
    );
  });
});
