import { Suspense } from "react";
import { RideDemo } from "@/components/ride/ride-demo";

export const metadata = { title: "Ride · Ryda" };

export default function RidePage() {
  return (
    <Suspense fallback={null}>
      <RideDemo />
    </Suspense>
  );
}
