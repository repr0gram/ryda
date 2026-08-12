import { describe, expect, test } from "vitest";
import { decodeStreams, encodeStreams } from "./wire";
import type { RideMeta, RideStreams } from "@/lib/analysis/types";

function ride(n: number): { streams: RideStreams; meta: RideMeta } {
  const time = new Float64Array(n);
  const distance = new Float64Array(n);
  const altitude = new Float64Array(n);
  const latlng = new Float64Array(n * 2);
  const heartrate = new Float32Array(n);
  const paused = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    time[i] = i;
    distance[i] = i * 7.3;
    altitude[i] = 100 + Math.sin(i / 50) * 40;
    // Coordinates need more precision than a float32 has: 1e-5 degrees is about
    // a metre, and rounding there would visibly wobble the route on the map.
    latlng[i * 2] = 45.4969699960202 + i * 1e-5;
    latlng[i * 2 + 1] = -73.55175998993218 - i * 1e-5;
    heartrate[i] = 120 + (i % 30);
    paused[i] = i % 97 === 0 ? 1 : 0;
  }
  return {
    streams: { time, distance, altitude, latlng, heartrate, paused, speedIsDerived: true },
    meta: { n, altitudeSource: "barometric" },
  };
}

describe("wire format", () => {
  test("round-trips every channel exactly", () => {
    const original = ride(500);
    const back = decodeStreams(encodeStreams(original.streams, original.meta));

    expect(back.meta).toEqual(original.meta);
    expect(back.streams.speedIsDerived).toBe(true);
    for (const key of ["time", "distance", "altitude", "latlng", "heartrate", "paused"] as const) {
      expect(Array.from(back.streams[key]!)).toEqual(Array.from(original.streams[key]!));
    }
  });

  test("keeps full coordinate precision", () => {
    const original = ride(10);
    const back = decodeStreams(encodeStreams(original.streams, original.meta));
    // Exact equality, not approximate: the whole point of shipping raw buffers
    // rather than JSON numbers is that nothing is reformatted on the way.
    expect(back.streams.latlng![0]).toBe(45.4969699960202);
    expect(back.streams.latlng![1]).toBe(-73.55175998993218);
  });

  test("omits channels the ride does not have", () => {
    const original = ride(20);
    delete original.streams.heartrate;
    const wire = encodeStreams(original.streams, original.meta);
    expect(wire.channels.heartrate).toBeUndefined();
    expect(decodeStreams(wire).streams.heartrate).toBeUndefined();
  });

  test("survives a payload large enough to break naive base64", () => {
    // String.fromCharCode(...bytes) throws past roughly 100k arguments, which a
    // three-hour ride clears easily. This is the case that only shows up on
    // real files.
    const original = ride(11_000);
    const back = decodeStreams(encodeStreams(original.streams, original.meta));
    expect(back.streams.time.length).toBe(11_000);
    expect(back.streams.time[10_999]).toBe(10_999);
    expect(back.streams.latlng!.length).toBe(22_000);
  });
});
