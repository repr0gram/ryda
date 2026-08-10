import { describe, expect, test } from "vitest";
import { isCycling, normaliseSport, sportLabel, sportKind } from "./sport";

describe("sport classification", () => {
  test("recognises the many spellings of cycling", () => {
    // FIT says "cycling", Strava GPX says "cycling", TCX says "Biking",
    // Strava's CSV says "Ride". All the same thing.
    for (const s of [
      "cycling",
      "Cycling",
      "Ride",
      "Biking",
      "biking",
      "VirtualRide",
      "virtual_ride",
      "EBikeRide",
      "gravel ride",
      "MountainBikeRide",
    ]) {
      expect(isCycling(s), `${s} should be cycling`).toBe(true);
    }
  });

  test("rejects everything that is not a bike", () => {
    // Nearly half a real Strava export was walks. Running these through
    // bicycle physics produces a meaningless number that then lands on the
    // fitness curve.
    for (const s of [
      "walking",
      "Walk",
      "running",
      "Run",
      "swimming",
      "Hike",
      "AlpineSki",
      "Workout",
      "other",
      "Other",
      "",
      null,
      undefined,
    ]) {
      expect(isCycling(s), `${s} should not be cycling`).toBe(false);
    }
  });

  test("normalises spelling and labels for display", () => {
    expect(normaliseSport("  Virtual Ride ")).toBe("virtual_ride");
    expect(normaliseSport(null)).toBe("unknown");
    expect(sportLabel("virtual_ride")).toBe("Virtual Ride");
    expect(sportLabel(null)).toBe("Activity");
    expect(sportKind("Walk")).toBe("other");
  });
});
