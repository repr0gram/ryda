import { RideDemo } from "@/components/ride/ride-demo";

export const metadata = {
  title: "Ride · Ryda",
};

/**
 * Demo surface for the Ride screen. The ride is generated client-side from a
 * fixed seed — typed arrays don't survive the RSC boundary as typed arrays, and
 * serialising ~7,000 samples across six channels as JSON would be megabytes.
 * Once ingestion lands this becomes a real activity id.
 */
export default function RidePage() {
  return <RideDemo />;
}
