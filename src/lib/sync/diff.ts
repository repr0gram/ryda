import type { RideSummary } from "@/lib/store/rides";
import type { WireRide } from "./wire";

/**
 * Has a ride's analysis changed since the server last saw it?
 *
 * Sync used to push only rides the server did not have, which made it
 * insert-only: once a ride was up, nothing could ever correct it. Every
 * improvement to the power model, every change to the rider's mass, and every
 * field a re-import newly picks up would stay stuck on whichever device
 * uploaded first. That is how a device's own calorie figure could sit in this
 * browser and never reach the phone.
 *
 * Compared at display precision, so floating-point noise does not re-push the
 * whole library on every sync.
 */
export function differs(local: RideSummary, remote: WireRide): boolean {
  const near = (a: number | null, b: number | null | undefined, dp = 1) => {
    if (a == null || b == null) return a == null && b == null;
    return Math.abs(a - b) < Math.pow(10, -dp);
  };
  return (
    local.name !== remote.name ||
    !near(local.load, remote.load) ||
    !near(local.weightedPower, remote.weightedPower) ||
    !near(local.meanPower, remote.meanPower) ||
    !near(local.distanceMeters, remote.distanceMeters, 0) ||
    !near(local.elevationGainMeters, remote.elevationGainMeters, 0) ||
    Math.round(local.movingSeconds) !== Math.round(remote.movingSeconds) ||
    !near(local.reportedCalories, remote.reportedCalories ?? null) ||
    local.confidence !== remote.confidence
  );
}
