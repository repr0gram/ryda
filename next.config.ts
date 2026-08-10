import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Top-level in Next 16 — `experimental.typedRoutes` was promoted.
  typedRoutes: true,
  // Turbopack is the default bundler in 16; this block is where its config
  // lives if we need it (MapLibre v6 is ESM-only, so watch this space).
  turbopack: {},
};

export default nextConfig;
