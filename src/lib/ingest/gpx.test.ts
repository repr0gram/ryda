import { beforeAll, describe, expect, test } from "vitest";
import { DOMParser as LinkeDomParser } from "linkedom";
import { parseGpx } from "./gpx";

/**
 * Parsed under linkedom rather than a browser DOM on purpose.
 *
 * linkedom's XML mode returns nothing from `getElementsByTagName("*")`, which
 * is exactly how heart rate silently disappeared from every GPX. Testing
 * against the stricter implementation keeps that from regressing.
 */
beforeAll(() => {
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = LinkeDomParser;
});

function gpx(type: string, points: { t: string; lat: number; lng: number; hr?: number }[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
 <metadata><time>${points[0].t}</time></metadata>
 <trk>
  <name>test activity</name>
  <type>${type}</type>
  <trkseg>
${points
  .map(
    (p) => `   <trkpt lat="${p.lat}" lon="${p.lng}">
    <ele>10</ele>
    <time>${p.t}</time>${
      p.hr
        ? `
    <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`
        : ""
    }
   </trkpt>`,
  )
  .join("\n")}
  </trkseg>
 </trk>
</gpx>`;
}

/** A short straight-line track, one point per second. */
function track(seconds: number, hr?: number) {
  return Array.from({ length: seconds }, (_, i) => ({
    t: new Date(Date.UTC(2026, 6, 11, 12, 0, i)).toISOString(),
    lat: 45.5 + i * 0.00005,
    lng: -73.55,
    hr,
  }));
}

describe("parseGpx", () => {
  test("extracts heart rate from the namespaced extension", () => {
    // The regression: gpxtpx:hr was being missed entirely, which silently
    // removed decoupling and the heart-rate confidence check from every GPX.
    const ride = parseGpx(gpx("cycling", track(30, 142)));
    expect(ride.streams.heartrate).toBeDefined();
    expect(ride.streams.heartrate![10]).toBeCloseTo(142, 0);
  });

  test("omits the heart rate stream when the file has none", () => {
    const ride = parseGpx(gpx("cycling", track(30)));
    expect(ride.streams.heartrate).toBeUndefined();
  });

  test("reads the activity type instead of assuming a ride", () => {
    expect(parseGpx(gpx("cycling", track(30))).sport).toBe("cycling");
    expect(parseGpx(gpx("walking", track(30))).sport).toBe("walking");
  });

  test("integrates distance from coordinates", () => {
    const ride = parseGpx(gpx("cycling", track(30)));
    const total = ride.streams.distance[ride.meta.n - 1];
    // ~5.5 m per 0.00005 degrees of latitude, over 29 steps.
    expect(total).toBeGreaterThan(100);
    expect(total).toBeLessThan(220);
  });

  test("rejects a teleporting fix instead of integrating it", () => {
    const points = track(30);
    // A bad fix ~80 km away — naively integrated this is a five-figure wattage.
    points[15].lat = 46.2;
    const ride = parseGpx(gpx("cycling", points));
    const total = ride.streams.distance[ride.meta.n - 1];
    expect(total).toBeLessThan(500);
    for (const v of ride.streams.speed!) expect(v).toBeLessThan(30);
  });

  test("refuses a file with no timestamps rather than guessing", () => {
    const noTime = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><type>cycling</type><trkseg>
      <trkpt lat="45.5" lon="-73.5"><ele>10</ele></trkpt>
      <trkpt lat="45.6" lon="-73.5"><ele>11</ele></trkpt>
    </trkseg></trk></gpx>`;
    expect(() => parseGpx(noTime)).toThrow(/timestamp/i);
  });
});
