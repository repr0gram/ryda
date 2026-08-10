import type { ParsedRide } from "./fit";
import { detectAltitudeSource } from "./fit";
import type { RideStreams } from "@/lib/analysis/types";

/**
 * GPX ingestion.
 *
 * Lower fidelity than FIT by construction — GPX carries no cadence, no power,
 * and stores heart rate in a vendor extension namespace. It matters because
 * Strava bulk exports contain GPX for anything not uploaded as FIT.
 *
 * Parsed with DOMParser rather than a dependency: the subset of GPX that
 * matters here is a flat list of <trkpt> elements, and togeojson would still
 * need a DOM shim on the server.
 */

const GAP_THRESHOLD_S = 5;

/** 108 km/h. A GPX step implying more than this is a bad fix, not a descent. */
const MAX_PLAUSIBLE_SPEED_MS = 30;

export function parseGpx(xml: string): ParsedRide {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("This file isn't valid GPX.");

  const points = Array.from(doc.getElementsByTagName("trkpt"));
  if (points.length < 2) {
    throw new Error("This GPX file contains no track points.");
  }

  const raw = points.map((pt) => ({
    lat: Number(pt.getAttribute("lat")),
    lng: Number(pt.getAttribute("lon")),
    ele: numberFrom(pt, "ele"),
    time: pt.getElementsByTagName("time")[0]?.textContent ?? null,
    // Heart rate lives in the Garmin TrackPointExtension namespace; match on
    // local name so any prefix works.
    hr: extensionValue(pt, "hr"),
    cad: extensionValue(pt, "cad"),
    temp: extensionValue(pt, "atemp"),
  }));

  const timed = raw.filter((p) => p.time);
  if (timed.length < 2) {
    throw new Error("This GPX has no timestamps, so it can't be analysed over time.");
  }

  const t0 = Date.parse(timed[0].time!) / 1000;
  const tEnd = Date.parse(timed[timed.length - 1].time!) / 1000;
  const n = Math.max(2, Math.round(tEnd - t0) + 1);

  const time = new Float64Array(n);
  const distance = new Float64Array(n);
  const altitude = new Float64Array(n);
  const latlng = new Float64Array(n * 2);
  const speed = new Float32Array(n);
  const paused = new Uint8Array(n);

  const hasHr = timed.some((p) => p.hr != null);
  const hasCad = timed.some((p) => p.cad != null);
  const hasTemp = timed.some((p) => p.temp != null);
  const heartrate = hasHr ? new Float32Array(n) : undefined;
  const cadence = hasCad ? new Float32Array(n) : undefined;
  const temperature = hasTemp ? new Float32Array(n) : undefined;

  // GPX carries no distance channel, so integrate it from the coordinates.
  //
  // A bad position fix — an urban canyon, a tunnel exit, a phone waking up —
  // teleports the track by hundreds of metres. Integrated naively that becomes
  // a one-second speed of 300 m/s, and since aerodynamic drag scales with the
  // cube of speed, a single bad fix becomes a five-figure wattage that poisons
  // the power curve and every peak figure derived from it.
  //
  // A jump that would require a superhuman speed is a measurement error, so the
  // rider is held in place for it rather than credited with the distance. That
  // slightly under-reports a genuine tunnel transit, which is the safe
  // direction.
  const cumulative = new Float64Array(timed.length);
  let rejectedFixes = 0;
  for (let i = 1; i < timed.length; i++) {
    const step = haversine(timed[i - 1], timed[i]);
    const dt = Math.max(
      1,
      (Date.parse(timed[i].time!) - Date.parse(timed[i - 1].time!)) / 1000,
    );
    if (step / dt > MAX_PLAUSIBLE_SPEED_MS) {
      cumulative[i] = cumulative[i - 1];
      rejectedFixes++;
      continue;
    }
    cumulative[i] = cumulative[i - 1] + step;
  }

  let cursor = 0;
  let gapSeconds = 0;

  for (let i = 0; i < n; i++) {
    const t = t0 + i;
    time[i] = i;
    while (
      cursor < timed.length - 1 &&
      Date.parse(timed[cursor + 1].time!) / 1000 <= t
    ) {
      cursor++;
    }
    const cur = timed[cursor];
    const next = timed[cursor + 1];
    const curT = Date.parse(cur.time!) / 1000;
    const nextT = next ? Date.parse(next.time!) / 1000 : curT;
    const span = nextT - curT;

    if (span > GAP_THRESHOLD_S && t > curT) {
      gapSeconds += 1;
      paused[i] = 1;
      distance[i] = cumulative[cursor];
      altitude[i] = cur.ele ?? 0;
      latlng[i * 2] = cur.lat;
      latlng[i * 2 + 1] = cur.lng;
      speed[i] = 0;
      if (heartrate) heartrate[i] = cur.hr ?? 0;
      if (cadence) cadence[i] = 0;
      if (temperature) temperature[i] = cur.temp ?? 0;
      continue;
    }

    const f = span > 0 && next ? Math.min(1, Math.max(0, (t - curT) / span)) : 0;
    const lerp = (a: number | null, b: number | null | undefined) => {
      if (a == null) return b ?? 0;
      if (b == null) return a;
      return a + (b - a) * f;
    };

    const d0 = cumulative[cursor];
    const d1 = cumulative[cursor + 1] ?? d0;
    distance[i] = d0 + (d1 - d0) * f;
    altitude[i] = lerp(cur.ele, next?.ele);
    latlng[i * 2] = lerp(cur.lat, next?.lat);
    latlng[i * 2 + 1] = lerp(cur.lng, next?.lng);
    if (heartrate) heartrate[i] = lerp(cur.hr, next?.hr);
    if (cadence) cadence[i] = lerp(cur.cad, next?.cad);
    if (temperature) temperature[i] = lerp(cur.temp, next?.temp);
  }

  for (let i = 1; i < n; i++) speed[i] = Math.max(0, distance[i] - distance[i - 1]);
  if (n > 1) speed[0] = speed[1];

  const streams: RideStreams = {
    time,
    distance,
    altitude,
    latlng,
    speed,
    heartrate,
    cadence,
    temperature,
    paused,
  };

  const startedAt = new Date(t0 * 1000).toISOString();
  const name = doc.getElementsByTagName("name")[0]?.textContent?.trim();

  return {
    streams,
    meta: { altitudeSource: detectAltitudeSource(altitude), n },
    name: name || "Ride",
    startedAt,
    sport: "cycling",
    hasMeasuredPower: false,
    devices: [],
    gapSeconds,
    reported: {},
  };
}

function numberFrom(el: Element, tag: string): number | null {
  const text = el.getElementsByTagName(tag)[0]?.textContent;
  if (!text) return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : null;
}

/** Find a TrackPointExtension child by local name, ignoring the prefix. */
function extensionValue(pt: Element, localName: string): number | null {
  const ext = pt.getElementsByTagName("extensions")[0];
  if (!ext) return null;
  for (const el of Array.from(ext.getElementsByTagName("*"))) {
    if (el.localName === localName) {
      const v = Number(el.textContent);
      return Number.isFinite(v) ? v : null;
    }
  }
  return null;
}

const EARTH_RADIUS_M = 6_371_008.8;

function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
