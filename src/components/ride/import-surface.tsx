"use client";

import { useState } from "react";
import type { ParsedRide } from "@/lib/ingest/fit";
import { FileDrop } from "./file-drop";
import { RideView } from "./ride-view";

export function ImportSurface() {
  const [ride, setRide] = useState<ParsedRide | null>(null);

  if (!ride) {
    return (
      <div className="mx-auto w-full max-w-2xl px-2 py-20">
        <h1 className="text-2xl font-medium tracking-tight text-ink">
          Ride analysis that tells you something
        </h1>
        <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-secondary">
          Drop a ride file to see estimated power, weighted power, decoupling and a
          route you can scrub. No power meter required — power is modelled from
          gradient, speed and mass, with cadence used to tell coasting from
          pedalling.
        </p>
        <div className="mt-8">
          <FileDrop onRide={setRide} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-1">
        <p className="text-[12px] text-ink-muted">
          {ride.devices.length > 0 ? `Recorded on ${ride.devices.join(" + ")}. ` : ""}
          Read locally — nothing was uploaded.
        </p>
        <button
          onClick={() => setRide(null)}
          className="rounded-md border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-3"
        >
          Open another file
        </button>
      </div>
      <RideView
        streams={ride.streams}
        meta={ride.meta}
        name={ride.name}
        startedAt={ride.startedAt}
      />
    </div>
  );
}
