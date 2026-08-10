"use client";

import dynamic from "next/dynamic";
import type { RideMapProps } from "./ride-map";

/**
 * MapLibre v6 is ESM-only and requires WebGL2, so it cannot be server-rendered.
 * Next 16 rejects `ssr: false` inside a Server Component, so the dynamic import
 * has to live in a Client Component — that is the entire job of this file.
 */
const RideMap = dynamic(() => import("./ride-map").then((m) => m.RideMap), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-surface-2">
      <span className="text-[13px] text-ink-muted">Loading map…</span>
    </div>
  ),
});

export function RideMapLoader(props: RideMapProps) {
  return <RideMap {...props} />;
}
