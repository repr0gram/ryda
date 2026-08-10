import type { ParsedRide } from "./fit";
import { detectAltitudeSource } from "./fit";
import type { RideStreams } from "@/lib/analysis/types";
import { normaliseSport } from "./sport";
import { findByLocalName } from "./gpx";

/**
 * TCX ingestion.
 *
 * Strava exports TCX (gzipped) for activities recorded without GPS — an
 * indoor session, or a walk tracked with only a heart-rate strap. Half a real
 * export turned out to be these, so skipping the format leaves most of a
 * library unreadable.
 *
 * Two things make TCX different from GPX here:
 *
 * 1. Trackpoints are sparse and heterogeneous. A point may carry only a
 *    timestamp and a heart rate, with no position, altitude or distance at all.
 * 2. `Sport` is limited to Running / Biking / Other, so a walk arrives as
 *    "Other". We keep that rather than guessing, and the sport rules decide
 *    what analysis is valid.
 */

const GAP_THRESHOLD_S = 30;

interface Point {
  t: number;
  lat: number | null;
  lng: number | null;
  ele: number | null;
  dist: number | null;
  hr: number | null;
  cad: number | null;
  watts: number | null;
}

export function parseTcx(xml: string): ParsedRide {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("This file isn't valid TCX.");

  const activity = doc.getElementsByTagName("Activity")[0];
  const sport = normaliseSport(activity?.getAttribute("Sport"));

  const points: Point[] = [];
  for (const tp of Array.from(doc.getElementsByTagName("Trackpoint"))) {
    const timeText = child(tp, "Time");
    if (!timeText) continue;
    const t = Date.parse(timeText) / 1000;
    if (!Number.isFinite(t)) continue;
    points.push({
      t,
      lat: num(child(tp, "LatitudeDegrees")),
      lng: num(child(tp, "LongitudeDegrees")),
      ele: num(child(tp, "AltitudeMeters")),
      dist: num(child(tp, "DistanceMeters")),
      // <HeartRateBpm><Value>n</Value></HeartRateBpm>
      hr: num(tp.getElementsByTagName("HeartRateBpm")[0]?.textContent),
      cad: num(child(tp, "Cadence")),
      watts: num(descendantByLocalName(tp, "Watts")),
    });
  }

  if (points.length < 2) throw new Error("This TCX file contains no track points.");
  points.sort((a, b) => a.t - b.t);

  const t0 = points[0].t;
  const tEnd = points[points.length - 1].t;
  const n = Math.max(2, Math.round(tEnd - t0) + 1);

  const hasPos = points.some((p) => p.lat != null && p.lng != null);
  const hasEle = points.some((p) => p.ele != null);
  const hasDist = points.some((p) => p.dist != null);
  const hasHr = points.some((p) => p.hr != null);
  const hasCad = points.some((p) => p.cad != null);
  const hasWatts = points.some((p) => p.watts != null);

  const time = new Float64Array(n);
  const distance = new Float64Array(n);
  const altitude = new Float64Array(n);
  const speed = new Float32Array(n);
  const paused = new Uint8Array(n);
  const latlng = hasPos ? new Float64Array(n * 2) : undefined;
  const heartrate = hasHr ? new Float32Array(n) : undefined;
  const cadence = hasCad ? new Float32Array(n) : undefined;
  const power = hasWatts ? new Float32Array(n) : undefined;

  let cursor = 0;
  let gapSeconds = 0;
  let lastDist = points[0].dist ?? 0;
  let lastEle = points[0].ele ?? 0;

  for (let i = 0; i < n; i++) {
    const t = t0 + i;
    time[i] = i;
    while (cursor < points.length - 1 && points[cursor + 1].t <= t) cursor++;

    const cur = points[cursor];
    const next = points[cursor + 1];
    const span = next ? next.t - cur.t : 0;

    // TCX sampling is irregular by nature, so the gap threshold is looser than
    // GPX's — treating a 10-second sampling interval as a stop would mark an
    // entire HR-only walk as paused.
    if (span > GAP_THRESHOLD_S && t > cur.t) {
      gapSeconds++;
      paused[i] = 1;
      distance[i] = lastDist;
      altitude[i] = lastEle;
      speed[i] = 0;
      if (latlng && cur.lat != null && cur.lng != null) {
        latlng[i * 2] = cur.lat;
        latlng[i * 2 + 1] = cur.lng;
      }
      if (heartrate) heartrate[i] = cur.hr ?? 0;
      if (cadence) cadence[i] = 0;
      if (power) power[i] = 0;
      continue;
    }

    const f = span > 0 && next ? Math.min(1, Math.max(0, (t - cur.t) / span)) : 0;
    const lerp = (a: number | null, b: number | null | undefined, fallback: number) => {
      if (a == null && b == null) return fallback;
      if (a == null) return b as number;
      if (b == null) return a;
      return a + (b - a) * f;
    };

    lastDist = hasDist ? lerp(cur.dist, next?.dist, lastDist) : lastDist;
    lastEle = hasEle ? lerp(cur.ele, next?.ele, lastEle) : lastEle;
    distance[i] = lastDist;
    altitude[i] = lastEle;
    if (latlng) {
      latlng[i * 2] = lerp(cur.lat, next?.lat, latlng[Math.max(0, i - 1) * 2]);
      latlng[i * 2 + 1] = lerp(cur.lng, next?.lng, latlng[Math.max(0, i - 1) * 2 + 1]);
    }
    if (heartrate) heartrate[i] = lerp(cur.hr, next?.hr, 0);
    if (cadence) cadence[i] = lerp(cur.cad, next?.cad, 0);
    if (power) power[i] = lerp(cur.watts, next?.watts, 0);
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
    power,
    paused,
  };

  const startedAt = new Date(t0 * 1000).toISOString();
  const name = doc.getElementsByTagName("Notes")[0]?.textContent?.trim();

  return {
    streams,
    meta: { altitudeSource: hasEle ? detectAltitudeSource(altitude) : "gps", n },
    name: name || "Activity",
    startedAt,
    sport,
    hasMeasuredPower: hasWatts,
    devices: [],
    gapSeconds,
    reported: {},
  };
}

function child(el: Element, tag: string): string | null {
  // Direct descendant lookup by tag; namespaces make querySelector unreliable.
  for (const c of Array.from(el.getElementsByTagName(tag))) {
    return c.textContent;
  }
  return null;
}

/** Same reasoning as the GPX helper — see findByLocalName there. */
function descendantByLocalName(el: Element, localName: string): string | null {
  return findByLocalName(el, localName);
}

function num(text: string | null | undefined): number | null {
  if (text == null) return null;
  const v = Number(text.trim());
  return Number.isFinite(v) ? v : null;
}
