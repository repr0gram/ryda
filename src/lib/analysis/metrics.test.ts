import { describe, expect, test } from "vitest";
import { buildPowerCurve, estimateFtp, fitCriticalPower, powerAt } from "./curve";
import {
  GROSS_EFFICIENCY,
  caloriesFrom,
  computeRideMetrics,
  decoupling,
  kilojoulesFrom,
  load,
  timeInZones,
  weightedPower,
} from "./metrics";
import {
  computeTrainingLoad,
  consistency,
  expandDailyLoad,
  rampRate,
} from "./training-load";

const constant = (value: number, n: number) => Float32Array.from({ length: n }, () => value);

describe("weightedPower", () => {
  test("converges to mean power for a steady effort, ramping in over one window", () => {
    // With no variation the 30 s rolling mean is flat, so the 4th-power
    // weighting has nothing to bite on and the answer is the mean — except for
    // the documented ramp-up, where partial head windows divide by the full
    // window size. That pulls the result slightly under, by less as the ride
    // gets longer. Both halves of that are asserted here.
    const hour = weightedPower(constant(200, 3600));
    expect(hour).toBeLessThan(200);
    expect(hour).toBeGreaterThan(199.5);

    // Convergence is asymptotic — the fixed ramp cost is amortised over a
    // longer ride but never fully disappears.
    const fourHours = weightedPower(constant(200, 14400));
    expect(fourHours).toBeGreaterThan(hour);
    expect(fourHours).toBeGreaterThan(199.9);
    expect(fourHours).toBeLessThan(200);
  });

  test("exceeds mean power for a surgy effort", () => {
    // Same average, wildly different cost: 5 min at 400 W then 5 min at 0 W.
    const surgy = new Float32Array(3600);
    for (let i = 0; i < 3600; i++) surgy[i] = Math.floor(i / 300) % 2 === 0 ? 400 : 0;
    const wp = weightedPower(surgy);
    expect(wp).toBeGreaterThan(200);
    expect(wp).toBeLessThan(400);
  });

  test("is order-dependent, unlike a mean", () => {
    const a = new Float32Array(1200);
    const b = new Float32Array(1200);
    for (let i = 0; i < 1200; i++) {
      a[i] = i < 600 ? 300 : 100;
      b[i] = i % 2 === 0 ? 300 : 100;
    }
    // Same mean; the fast alternation is smoothed away by the 30 s window,
    // so the blocked version must score higher.
    expect(weightedPower(a)).toBeGreaterThan(weightedPower(b));
  });

  test("returns zero for an empty stream", () => {
    expect(weightedPower(new Float32Array(0))).toBe(0);
  });
});

describe("load", () => {
  test("one hour at threshold is exactly 100", () => {
    expect(load(3600, 250, 250)).toBeCloseTo(100, 10);
  });

  test("scales linearly with duration and quadratically with intensity", () => {
    expect(load(7200, 250, 250)).toBeCloseTo(200, 10);
    expect(load(3600, 500, 250)).toBeCloseTo(400, 10);
  });

  test("is zero without a threshold to compare against", () => {
    expect(load(3600, 250, 0)).toBe(0);
  });
});

describe("decoupling", () => {
  test("reports near zero when power and heart rate hold together", () => {
    const n = 3600;
    const watts = constant(200, n);
    const hr = constant(150, n);
    const d = decoupling(watts, hr);
    expect(d).not.toBeNull();
    expect(Math.abs(d!.percent)).toBeLessThan(0.5);
  });

  test("reports positive drift when heart rate climbs at the same power", () => {
    const n = 3600;
    const watts = constant(200, n);
    const hr = Float32Array.from({ length: n }, (_, i) => (i < n / 2 ? 140 : 160));
    const d = decoupling(watts, hr)!;
    expect(d.percent).toBeGreaterThan(10);
  });

  test("declines to guess on a stream too short to split", () => {
    expect(decoupling(constant(200, 30), constant(150, 30))).toBeNull();
  });
});

describe("timeInZones", () => {
  test("buckets values and overflows above the last boundary", () => {
    const values = Float32Array.from([10, 20, 30, 40, 100]);
    expect(timeInZones(values, [15, 25, 45])).toEqual([1, 1, 2, 1]);
  });
});

describe("power curve", () => {
  test("a constant effort yields the same power at every duration", () => {
    const curve = buildPowerCurve(constant(250, 3600));
    expect(powerAt(curve, 60)).toBeCloseTo(250, 1);
    expect(powerAt(curve, 1200)).toBeCloseTo(250, 1);
  });

  test("finds the best window regardless of where it sits", () => {
    const watts = new Float32Array(3600);
    watts.fill(150);
    for (let i = 2000; i < 2300; i++) watts[i] = 400; // a 5 min effort
    const curve = buildPowerCurve(watts);
    expect(powerAt(curve, 300)).toBeCloseTo(400, 0);
    // Averaged over 10 min the 5 min effort is diluted.
    expect(powerAt(curve, 600)).toBeLessThan(400);
    expect(powerAt(curve, 600)).toBeGreaterThan(150);
  });

  test("is monotonically non-increasing with duration", () => {
    const watts = Float32Array.from({ length: 3600 }, () => 100 + Math.random() * 300);
    const curve = buildPowerCurve(watts);
    for (let i = 1; i < curve.watts.length; i++) {
      if (curve.watts[i] === 0) continue;
      expect(curve.watts[i]).toBeLessThanOrEqual(curve.watts[i - 1] + 1e-6);
    }
  });

  test("records where the best effort started", () => {
    const watts = new Float32Array(3600);
    watts.fill(100);
    for (let i = 1500; i < 1560; i++) watts[i] = 500;
    const curve = buildPowerCurve(watts);
    const idx = curve.durations.indexOf(60);
    expect(curve.offsets[idx]).toBe(1500);
  });

  test("recovers CP and W-prime from a synthetic hyperbolic rider", () => {
    // Construct a curve that obeys P = CP + W'/t exactly, then fit it back.
    const cp = 260;
    const wPrime = 21000;
    const durations = [120, 180, 300, 420, 600, 720, 900];
    const curve = {
      durations: Int32Array.from(durations),
      watts: Float32Array.from(durations.map((t) => cp + wPrime / t)),
      offsets: new Int32Array(durations.length),
    };
    const fit = fitCriticalPower(curve)!;
    expect(fit.cp).toBeCloseTo(cp, 0);
    expect(fit.wPrime).toBeCloseTo(wPrime, -2);
    expect(fit.r2).toBeGreaterThan(0.999);
  });

  test("FTP from a 20 minute best is 95% of it", () => {
    const watts = new Float32Array(3600);
    watts.fill(100);
    for (let i = 600; i < 1800; i++) watts[i] = 300;
    const est = estimateFtp(buildPowerCurve(watts))!;
    expect(est.method).toBe("20min");
    expect(est.watts).toBeCloseTo(285, 0);
    expect(est.note).toMatch(/fresh/i);
  });
});

describe("training load", () => {
  test("inserts explicit zeros for rest days", () => {
    const daily = expandDailyLoad([
      { date: "2026-01-01", load: 100 },
      { date: "2026-01-05", load: 50 },
    ]);
    expect(daily).toHaveLength(5);
    expect(daily.map((d) => d.load)).toEqual([100, 0, 0, 0, 50]);
  });

  test("sums multiple activities on the same day", () => {
    const daily = expandDailyLoad([
      { date: "2026-01-01", load: 60 },
      { date: "2026-01-01", load: 40 },
    ]);
    expect(daily).toEqual([{ date: "2026-01-01", load: 100 }]);
  });

  test("fitness DECAYS across a rest week", () => {
    // The classic bug is iterating activities instead of calendar days, which
    // makes fitness monotonically increase. This is the regression guard.
    const entries = [
      ...Array.from({ length: 30 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, "0")}`,
        load: 80,
      })),
      { date: "2026-02-10", load: 0 },
    ];
    const series = computeTrainingLoad(entries);
    const lastTrainingDay = series.find((d) => d.date === "2026-01-30")!;
    const afterRest = series.find((d) => d.date === "2026-02-06")!;
    expect(afterRest.fitness).toBeLessThan(lastTrainingDay.fitness);
  });

  test("fatigue falls faster than fitness during rest", () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      load: 80,
    }));
    const series = computeTrainingLoad(entries, { to: "2026-02-14" });
    const last = series[series.length - 1];
    // Fresh: fitness retained, fatigue shed, so form is strongly positive.
    expect(last.form).toBeGreaterThan(0);
    expect(last.fatigue).toBeLessThan(last.fitness);
  });

  test("steady daily load converges toward that load", () => {
    const entries = Array.from({ length: 200 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
      return { date: d.toISOString().slice(0, 10), load: 100 };
    });
    const series = computeTrainingLoad(entries);
    expect(series[series.length - 1].fitness).toBeGreaterThan(95);
    expect(series[series.length - 1].fitness).toBeLessThanOrEqual(100);
  });

  test("ramp rate is positive while building and consistency counts active days", () => {
    const entries = Array.from({ length: 28 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, "0")}`,
      load: i % 2 === 0 ? 90 : 0,
    }));
    const series = computeTrainingLoad(entries);
    expect(rampRate(series)).toBeGreaterThan(0);
    expect(consistency(series, 28)).toBeCloseTo(0.5, 1);
  });
});

describe("energy from a stored summary", () => {
  test("matches the sum over the power stream", () => {
    // The list endpoint cannot decode streams for every ride, so it derives
    // work from mean power and moving time instead. That shortcut is only valid
    // because resting samples are zero watts AND are excluded from the mean —
    // if either ever stops being true this test is what catches it.
    const n = 600;
    const watts = new Float32Array(n);
    const time = new Float64Array(n);
    const distance = new Float64Array(n);
    const altitude = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      time[i] = i;
      // Stopped at a light for the middle two minutes: no distance, no watts.
      const moving = i < 200 || i >= 320;
      distance[i] = i === 0 ? 0 : distance[i - 1] + (moving ? 8 : 0);
      watts[i] = moving ? 150 + (i % 40) : 0;
    }

    const metrics = computeRideMetrics({ watts, time, distance, altitude, ftp: 250 });
    const derived = kilojoulesFrom(metrics.meanPower, metrics.movingSeconds);

    // Within a sample's worth of work — the moving-time loop starts at i = 1.
    expect(Math.abs(derived - metrics.kilojoules)).toBeLessThan(0.2);
  });

  test("converts work to calories at a stated efficiency, not by coincidence", () => {
    expect(caloriesFrom(1000)).toBeCloseTo(1000 / GROSS_EFFICIENCY / 4.184, 6);
    expect(caloriesFrom(0)).toBe(0);

    // Gross efficiency is physiologically bounded at roughly 18-23%, so the
    // kcal-per-kJ ratio can only live between about 1.04 and 1.33. Anything
    // outside that is an assumption no rider embodies — heart-rate-derived
    // figures reaching 2.0 kcal/kJ imply 11.5% efficiency, which is the check
    // this bound exists to encode.
    const ratio = caloriesFrom(1000) / 1000;
    expect(ratio).toBeGreaterThan(1 / 0.23 / 4.184);
    expect(ratio).toBeLessThan(1 / 0.18 / 4.184);
  });

  test("a ride with no moving time has no energy", () => {
    expect(kilojoulesFrom(200, 0)).toBe(0);
    expect(kilojoulesFrom(0, 3600)).toBe(0);
  });
});
