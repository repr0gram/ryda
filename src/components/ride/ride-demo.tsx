"use client";

import { useMemo } from "react";
import { makeSyntheticRide } from "@/lib/demo/synthetic-ride";
import { RideView } from "./ride-view";

export function RideDemo() {
  // Fixed seed: the route must be identical on every render so screenshots are
  // comparable and nothing shifts under the cursor.
  const ride = useMemo(() => makeSyntheticRide({ seed: 20260809 }), []);

  return (
    <RideView
      streams={ride.streams}
      meta={ride.meta}
      name={ride.name}
      startedAt={ride.startedAt}
    />
  );
}
