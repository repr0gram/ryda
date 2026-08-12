import { describe, expect, test } from "vitest";
import { differs } from "./diff";
import type { RideSummary } from "@/lib/store/rides";
import type { WireRide } from "./wire";

const local: RideSummary = {
  id: "29771551-347",
  name: "Afternoon Ride",
  startedAt: "2026-08-09T16:30:41.000Z",
  localDate: "2026-08-09",
  sport: "cycling",
  n: 20805,
  altitudeSource: "barometric",
  hasMeasuredPower: false,
  devices: [],
  durationSeconds: 20804,
  movingSeconds: 15919,
  distanceMeters: 105793.5,
  elevationGainMeters: 262.06,
  meanPower: 100.19,
  weightedPower: 122.06,
  load: 182.49,
  meanHeartRate: 160,
  reportedCalories: null,
  decouplingPercent: 23.5,
  confidence: "high",
  importedAt: "2026-08-12T00:00:00.000Z",
};

const remote: WireRide = {
  id: local.id,
  name: local.name,
  startedAt: local.startedAt,
  localDate: local.localDate,
  sport: local.sport,
  hasMeasuredPower: false,
  devices: [],
  durationSeconds: local.durationSeconds,
  movingSeconds: local.movingSeconds,
  distanceMeters: local.distanceMeters,
  elevationGainMeters: local.elevationGainMeters,
  meanPower: local.meanPower,
  weightedPower: local.weightedPower,
  load: local.load,
  meanHeartRate: local.meanHeartRate,
  reportedCalories: null,
  decouplingPercent: local.decouplingPercent,
  confidence: local.confidence,
  sampleCount: local.n,
  altitudeSource: local.altitudeSource,
};

describe("differs", () => {
  test("an unchanged ride is not re-pushed", () => {
    // The property that keeps sync cheap: without it every sync would re-upload
    // the entire library forever.
    expect(differs(local, remote)).toBe(false);
  });

  test("survives the float noise of a round trip through JSON and Postgres", () => {
    // real → float4 → JSON loses precision well below anything displayed.
    expect(
      differs(local, {
        ...remote,
        load: 182.49001,
        weightedPower: 122.06003,
        meanPower: 100.18999,
        elevationGainMeters: 262.0601,
      }),
    ).toBe(false);
  });

  test("a device calorie figure arriving locally is a change", () => {
    // Exactly the case that was stuck: a re-import finds total_calories in the
    // file, and sync has to carry it up to a ride the server already has.
    expect(differs({ ...local, reportedCalories: 4491 }, remote)).toBe(true);
  });

  test("a recomputed load is a change", () => {
    // Every improvement to the power model lands here.
    expect(differs({ ...local, load: 173.2 }, remote)).toBe(true);
  });

  test("a rename is a change", () => {
    expect(differs({ ...local, name: "Big one" }, remote)).toBe(true);
  });

  test("confidence dropping is a change", () => {
    expect(differs({ ...local, confidence: "low" }, remote)).toBe(true);
  });

  test("a server row predating the calories field is not a phantom change", () => {
    // Older rows have the key absent rather than null; both mean "nothing
    // recorded" and must not trigger an endless re-push loop.
    const older = { ...remote };
    delete (older as { reportedCalories?: number | null }).reportedCalories;
    expect(differs(local, older)).toBe(false);
  });
});
