#!/usr/bin/env node
/**
 * Dump the structure of a FIT/GPX file: which record fields are actually
 * populated, how often, and what the session summary claims.
 *
 * Device vendors populate wildly different subsets of the FIT profile, so
 * "which fields does THIS head unit write" is the first question any importer
 * has to answer. Guessing produces an importer that works on one brand.
 *
 *   node scripts/inspect-fit.mjs "sample data/Afternoon_Ride.fit"
 */
import { readFile } from "node:fs/promises";
import FitParser from "fit-file-parser";

const Parser = FitParser.default ?? FitParser;
const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/inspect-fit.mjs <file.fit>");
  process.exit(1);
}

const buf = await readFile(path);
const parser = new Parser({
  force: true,
  speedUnit: "m/s",
  lengthUnit: "m",
  temperatureUnit: "celsius",
  elapsedRecordField: true,
  mode: "list",
});

const data = await new Promise((resolve, reject) =>
  parser.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    (err, d) => (err ? reject(err) : resolve(d)),
  ),
);

console.log("top-level keys:", Object.keys(data).join(", "));

const records = data.records ?? [];
console.log(`\nrecords: ${records.length}`);

const counts = new Map();
for (const r of records) {
  for (const [k, v] of Object.entries(r)) {
    if (v === null || v === undefined) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
}
console.log("\npopulated record fields:");
for (const [k, c] of [...counts].sort((a, b) => b[1] - a[1])) {
  const example = records.find((r) => r[k] !== null && r[k] !== undefined)?.[k];
  const pct = ((c / records.length) * 100).toFixed(0).padStart(3);
  console.log(
    `  ${k.padEnd(24)} ${pct}%  ${JSON.stringify(example)?.slice(0, 52) ?? ""}`,
  );
}

const sessions = data.sessions ?? [];
console.log(`\nsessions: ${sessions.length}`);
for (const s of sessions) {
  console.log(
    JSON.stringify(
      {
        sport: s.sport,
        sub_sport: s.sub_sport,
        start_time: s.start_time,
        total_distance: s.total_distance,
        total_elapsed_time: s.total_elapsed_time,
        total_timer_time: s.total_timer_time,
        total_ascent: s.total_ascent,
        avg_speed: s.avg_speed,
        avg_heart_rate: s.avg_heart_rate,
        avg_cadence: s.avg_cadence,
        avg_power: s.avg_power,
      },
      null,
      2,
    ),
  );
}

const devices = data.device_infos ?? [];
console.log(`\ndevice_infos: ${devices.length}`);
for (const d of devices.slice(0, 5)) {
  console.log(
    "  " +
      JSON.stringify({
        manufacturer: d.manufacturer,
        product: d.product,
        product_name: d.product_name,
        device_type: d.device_type,
      }),
  );
}

// Sampling cadence decides whether we can model acceleration at all.
if (records.length > 2) {
  const gaps = [];
  for (let i = 1; i < Math.min(records.length, 4000); i++) {
    const a = records[i - 1].timestamp;
    const b = records[i].timestamp;
    if (a && b) gaps.push((new Date(b) - new Date(a)) / 1000);
  }
  gaps.sort((a, b) => a - b);
  console.log(
    `\nsample interval: median ${gaps[Math.floor(gaps.length / 2)]}s, ` +
      `min ${gaps[0]}s, max ${gaps[gaps.length - 1]}s`,
  );
}
