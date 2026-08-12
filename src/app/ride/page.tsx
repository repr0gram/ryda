import { Suspense } from "react";
import { RideLoader } from "@/components/ride/ride-loader";

export const metadata = { title: "Ride · Ryda" };

export default function RidePage() {
  return (
    <Suspense fallback={null}>
      <RideLoader />
    </Suspense>
  );
}
