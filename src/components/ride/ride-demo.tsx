"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { makeSyntheticRide } from "@/lib/demo/synthetic-ride";
import { getStreams, listRides, type RideSummary } from "@/lib/store/rides";
import type { RideMeta, RideStreams } from "@/lib/analysis/types";
import { RideView } from "./ride-view";

interface Loaded {
  streams: RideStreams;
  meta: RideMeta;
  name: string;
  startedAt: string;
}

/**
 * Opens a saved ride when given ?id=, and falls back to a generated ride so the
 * screen is explorable before anything has been imported.
 */
export function RideDemo() {
  const params = useSearchParams();
  const id = params.get("id");
  const [stored, setStored] = useState<Loaded | null | "missing">(null);

  // Fixed seed: the demo route must be identical on every render so nothing
  // shifts under the cursor and screenshots stay comparable.
  const synthetic = useMemo(() => makeSyntheticRide({ seed: 20260809 }), []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const [streams, rides] = await Promise.all([getStreams(id), listRides()]);
      if (cancelled) return;
      const summary: RideSummary | undefined = rides.find((r) => r.id === id);
      if (!streams || !summary) {
        setStored("missing");
        return;
      }
      setStored({
        streams: streams.streams,
        meta: streams.meta,
        name: summary.name,
        startedAt: summary.startedAt,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (id && stored === null) {
    return (
      <p className="mx-auto max-w-[1400px] px-6 py-10 text-[13px] text-ink-muted">
        Loading ride…
      </p>
    );
  }

  if (id && stored === "missing") {
    return (
      <p className="mx-auto max-w-[1400px] px-6 py-10 text-[13px] text-ink-muted">
        That ride isn&apos;t in this browser&apos;s library.
      </p>
    );
  }

  const ride = stored && stored !== "missing" ? stored : synthetic;
  return (
    <RideView
      streams={ride.streams}
      meta={ride.meta}
      name={ride.name}
      startedAt={ride.startedAt}
    />
  );
}
