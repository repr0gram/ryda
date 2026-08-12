import { describe, expect, test } from "vitest";
import { dayDiff, localToday } from "./calendar";

describe("localToday", () => {
  test("a supplied local date wins over the server clock", () => {
    // The whole point: the rider's device knows what day it is where the rider
    // is, and the server does not.
    expect(localToday("2026-08-12", ["2026-08-12"])).toBe("2026-08-12");
  });

  test("rejects anything that is not a plain YYYY-MM-DD", () => {
    for (const bad of ["", "today", "2026-8-1", "2026-08-12T10:00:00Z", "9999-99-99"]) {
      expect(localToday(bad, ["2026-01-01"])).not.toBe(bad);
    }
  });

  test("never lands before the newest ride, so the series is never empty", () => {
    // A rider in UTC+12 records a ride the UTC server has not reached yet.
    // Without the clamp, every ride is "in the future", the dense day series
    // comes back empty, and reading its last element throws a 500.
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(localToday(null, [future])).toBe(future);
    expect(dayDiff(future, localToday(null, [future]))).toBe(0);
  });

  test("falls back to the server day when rides are all in the past", () => {
    const utc = new Date().toISOString().slice(0, 10);
    expect(localToday(null, ["2020-01-01"])).toBe(utc);
  });

  test("handles an account with no rides at all", () => {
    expect(localToday(null, [])).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("dayDiff", () => {
  test("counts whole days forward", () => {
    expect(dayDiff("2026-08-10", "2026-08-12")).toBe(2);
  });

  test("is zero on the same day, which is what a rider expects the evening they ride", () => {
    expect(dayDiff("2026-08-12", "2026-08-12")).toBe(0);
  });

  test("crosses a month boundary", () => {
    expect(dayDiff("2026-07-31", "2026-08-01")).toBe(1);
  });

  test("crosses a DST boundary without drifting", () => {
    // North American DST ends 1 Nov 2026. Treating both ends as UTC midnights
    // keeps this at exactly 2 rather than 2.04 days rounded.
    expect(dayDiff("2026-10-31", "2026-11-02")).toBe(2);
  });
});
