"use client";

import { useEffect, useRef } from "react";
// v6 is ESM-only and ships no default export — named imports are required.
import {
  Map as MlMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type LngLatBoundsLike,
} from "maplibre-gl";
import type { CursorStore, Selection } from "@/lib/cursor-store";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * OpenFreeMap: no API key, no account, no request cap, commercial use allowed.
 * Kept in an env var because the public instance is donation-funded — if it
 * ever goes away, their weekly planet dumps can be self-hosted at the same
 * style paths without touching this file.
 */
const TILE_BASE =
  process.env.NEXT_PUBLIC_MAP_STYLE_BASE ?? "https://tiles.openfreemap.org/styles";

/**
 * Point MapLibre at a worker we serve ourselves.
 *
 * Its default is `new URL('./maplibre-gl-worker.mjs', import.meta.url)`, which
 * after bundling resolves inside /_next/static/chunks/ — a 404 that Next answers
 * with HTML, so the module worker is rejected for its MIME type and the map
 * never fires `load`. scripts/sync-maplibre-worker.mjs puts the file here.
 *
 * Module scope, so it runs exactly once before any Map is constructed.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export interface RideMapProps {
  latlng: Float64Array;
  /** Values used to colour the trace; same sample count as latlng/2. */
  channel: Float32Array | Float64Array;
  /** Cumulative metres — needed to align colour stops with the line. */
  distance: Float64Array;
  /** CSS custom property for this channel's hue. */
  colorToken: string;
  cursor: CursorStore;
  selection: Selection | null;
}

export function RideMap({
  latlng,
  channel,
  distance,
  colorToken,
  cursor,
  selection,
}: RideMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const readyRef = useRef(false);

  // --- create the map once ------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host || latlng.length < 4) return;

    const coords = toCoordinates(latlng);
    const bounds = boundsOf(coords);

    const map = new MlMap({
      container: host,
      style: `${TILE_BASE}/${isDark() ? "dark" : "positron"}`,
      bounds,
      fitBoundsOptions: { padding: 48 },
      attributionControl: { compact: true },
      // Terrain wants pitch headroom; the plan calls for a 3D route view next.
      maxPitch: 85,
    });
    mapRef.current = map;

    // Exposed so scripts/capture.mjs can wait for tiles instead of guessing at
    // a sleep duration. Development only — never shipped to production.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __rydaMap?: MlMap }).__rydaMap = map;
    }

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.scrollZoom.setWheelZoomRate(1 / 300);

    const marker = new Marker({ element: buildMarker(colorToken) });
    markerRef.current = marker;

    map.on("load", () => {
      readyRef.current = true;
      map.addSource("route", {
        type: "geojson",
        // line-gradient reads ["line-progress"], which only exists when the
        // source computes line metrics.
        lineMetrics: true,
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
      });

      // A dark casing under the trace keeps it legible over both pale roads
      // and dark hillshade.
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": isDark() ? "#000000" : "#ffffff",
          "line-opacity": 0.55,
          "line-width": 7,
        },
      });

      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": 4,
          "line-gradient": gradientFor(channel, distance, colorToken, host),
        },
      });

      marker.setLngLat(coords[0] as [number, number]).addTo(map);
    });

    return () => {
      readyRef.current = false;
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Route geometry is fixed for a ride; channel/colour changes are handled
    // by the effects below rather than by rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latlng]);

  // --- recolour when the channel changes ----------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const host = hostRef.current;
    if (!map || !host) return;
    const apply = () => {
      if (!map.getLayer("route")) return;
      map.setPaintProperty("route", "line-gradient", gradientFor(channel, distance, colorToken, host));
    };
    if (readyRef.current) apply();
    else map.once("load", apply);

    const el = markerRef.current?.getElement();
    if (el) el.style.background = `var(${colorToken})`;
  }, [channel, distance, colorToken]);

  // --- follow the scrub cursor, imperatively -------------------------------
  useEffect(() => {
    const unsubscribe = cursor.subscribe((idx) => {
      const marker = markerRef.current;
      if (!marker) return;
      const el = marker.getElement();
      if (idx === null || idx * 2 + 1 >= latlng.length) {
        el.style.opacity = "0";
        return;
      }
      el.style.opacity = "1";
      marker.setLngLat([latlng[idx * 2 + 1], latlng[idx * 2]]);
    });
    return unsubscribe;
  }, [cursor, latlng]);

  // --- zoom to a selected range -------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (!selection) {
      map.fitBounds(boundsOf(toCoordinates(latlng)), { padding: 48, duration: 600 });
      return;
    }
    const slice = latlng.subarray(selection.from * 2, (selection.to + 1) * 2);
    if (slice.length < 4) return;
    map.fitBounds(boundsOf(toCoordinates(slice)), { padding: 72, duration: 600 });
  }, [selection, latlng]);

  return <div ref={hostRef} className="h-full w-full" />;
}

function isDark(): boolean {
  if (typeof document === "undefined") return true;
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return !window.matchMedia("(prefers-color-scheme: light)").matches;
}

function toCoordinates(latlng: Float64Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < latlng.length; i += 2) out.push([latlng[i + 1], latlng[i]]);
  return out;
}

function boundsOf(coords: [number, number][]): LngLatBoundsLike {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/**
 * Colour the trace by magnitude using a single-hue ramp — the sequential rule.
 * Low values sit near the surface, high values at full chroma, so the eye reads
 * the climbs without needing a legend.
 */
function gradientFor(
  channel: ArrayLike<number>,
  distance: ArrayLike<number>,
  colorToken: string,
  host: HTMLElement,
): ExpressionSpecification {
  const styles = getComputedStyle(host);
  const base = styles.getPropertyValue(colorToken).trim() || "#3987e5";
  const surface = styles.getPropertyValue("--surface-2").trim() || "#1a1c20";

  const { lo, hi } = percentileRange(channel, 0.02, 0.98);
  const span = hi - lo || 1;

  const n = Math.min(channel.length, distance.length);
  const start = distance[0] ?? 0;
  const total = (distance[n - 1] ?? 0) - start || 1;

  // `line-progress` is normalised by DISTANCE along the line, but samples are
  // spaced by TIME. Those only coincide at constant speed, so mapping stop ->
  // sample index directly paints climbs with descent colours. Walk the distance
  // array instead.
  const STOPS = 160;
  const expr: unknown[] = ["interpolate", ["linear"], ["line-progress"]];
  let cursor = 0;
  for (let s = 0; s < STOPS; s++) {
    const t = s / (STOPS - 1);
    const targetDistance = start + t * total;
    while (cursor < n - 1 && distance[cursor + 1] < targetDistance) cursor++;
    const norm = clamp01((channel[cursor] - lo) / span);
    // The low end still has to read as the route. Mixing all the way down to
    // the surface makes coasting segments vanish into a dark basemap and its
    // casing, which looks like a broken trace rather than low power. Starting
    // at 55% keeps the whole line legible while leaving clear headroom for
    // magnitude.
    expr.push(t, mix(surface, base, 0.55 + norm * 0.45));
  }
  return expr as ExpressionSpecification;
}

/** Trim outliers so one GPS spike doesn't flatten the whole colour range. */
function percentileRange(
  values: ArrayLike<number>,
  low: number,
  high: number,
): { lo: number; hi: number } {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) finite.push(values[i]);
  }
  if (finite.length === 0) return { lo: 0, hi: 1 };
  finite.sort((a, b) => a - b);
  const at = (p: number) => finite[Math.min(finite.length - 1, Math.floor(p * finite.length))];
  return { lo: at(low), hi: at(high) };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function mix(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return to;
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().replace("#", "");
  if (m.length !== 3 && m.length !== 6) return null;
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildMarker(colorToken: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "width:14px",
    "height:14px",
    "border-radius:9999px",
    `background:var(${colorToken})`,
    "box-shadow:0 0 0 3px var(--surface-1), 0 2px 6px rgba(0,0,0,0.45)",
    "opacity:0",
    "transition:opacity 120ms ease",
    "pointer-events:none",
  ].join(";");
  return el;
}
