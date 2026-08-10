#!/usr/bin/env node
/**
 * Copy MapLibre's worker bundle into public/.
 *
 * MapLibre v6 resolves its worker with `new URL('./maplibre-gl-worker.mjs',
 * import.meta.url)`. Once bundled, `import.meta.url` points at the emitted
 * chunk, so it requests the worker from inside /_next/static/chunks/ — where it
 * does not exist. Next answers with its HTML 404 page, and a module worker
 * rejects `text/html`, so the map silently never finishes loading.
 *
 * Serving the worker from a stable public path and calling `setWorkerUrl()`
 * sidesteps bundler-specific worker resolution entirely. The worker imports
 * `./maplibre-gl-shared.mjs` relatively, so that file has to sit beside it.
 */
import { copyFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";

const SRC = "node_modules/maplibre-gl/dist";
const DEST = "public/maplibre";

const FILES = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
  "maplibre-gl-worker-dev.mjs",
  "maplibre-gl-shared-dev.mjs",
];

await mkdir(DEST, { recursive: true });

let copied = 0;
for (const file of FILES) {
  const from = join(SRC, file);
  try {
    await access(from);
  } catch {
    continue; // optional dev variants may not ship in every release
  }
  await copyFile(from, join(DEST, file));
  copied++;
}

if (copied === 0) {
  console.error("sync-maplibre-worker: no worker files found — is maplibre-gl installed?");
  process.exit(1);
}
console.log(`sync-maplibre-worker: copied ${copied} file(s) to ${DEST}/`);
