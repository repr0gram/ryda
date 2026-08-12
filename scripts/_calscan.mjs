/** Exhaustively search a FIT file for anything calorie-shaped. */
import { readFileSync } from "node:fs";
import FitParser from "fit-file-parser";

const path = process.argv[2];
const Parser = FitParser.default ?? FitParser;
const parser = new Parser({
  force: true,
  speedUnit: "m/s",
  lengthUnit: "m",
  temperatureUnit: "celsius",
  elapsedRecordField: true,
  mode: "both",
});

const data = await new Promise((resolve, reject) => {
  parser.parse(readFileSync(path), (err, out) => (err ? reject(err) : resolve(out)));
});

console.log("top-level keys:", Object.keys(data).join(", "));

// 1. every key anywhere in the tree whose name mentions calories or energy
const calorieKeys = new Map();
// 2. every number anywhere in the tree that lands near Strava's figure
const nearTarget = [];
const TARGET = Number(process.argv[3] ?? 4491);

function walk(node, path, depth) {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    // Sample the array rather than walking thousands of records
    for (const [i, v] of node.slice(0, 5).entries()) walk(v, `${path}[${i}]`, depth + 1);
    if (node.length > 5) walk(node[node.length - 1], `${path}[last]`, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (/cal|energ|kj|joule|work/i.test(key)) {
      const shown = typeof value === "object" ? JSON.stringify(value)?.slice(0, 80) : value;
      const existing = calorieKeys.get(key) ?? [];
      if (existing.length < 4) existing.push(`${here} = ${shown}`);
      calorieKeys.set(key, existing);
    }
    if (typeof value === "number" && Math.abs(value - TARGET) < TARGET * 0.06) {
      nearTarget.push(`${here} = ${value}`);
    }
    walk(value, here, depth + 1);
  }
}
walk(data, "", 0);

console.log(`\n=== keys mentioning calories / energy / work ===`);
if (calorieKeys.size === 0) console.log("  (none)");
for (const [key, examples] of calorieKeys) {
  console.log(`  ${key}:`);
  for (const e of examples) console.log(`     ${e}`);
}

// Records carry a per-sample calories field in some devices; check if it ever moves.
const records = data.records ?? [];
const withCalories = records.filter((r) => typeof r.calories === "number");
if (withCalories.length) {
  const values = withCalories.map((r) => r.calories);
  const max = Math.max(...values);
  const nonZero = values.filter((v) => v !== 0).length;
  console.log(
    `\nrecord.calories: ${withCalories.length} samples, max ${max}, ${nonZero} non-zero`,
  );
}

console.log(`\n=== any number within 6% of ${TARGET} ===`);
console.log(nearTarget.length ? nearTarget.slice(0, 30).join("\n") : "  (none)");

// Laps often carry total_calories even when the session does not.
const laps = data.laps ?? [];
console.log(`\n=== laps: ${laps.length} ===`);
if (laps.length) {
  const keys = new Set(laps.flatMap((l) => Object.keys(l)));
  console.log("  lap fields:", [...keys].join(", "));
  const total = laps.reduce((sum, l) => sum + (l.total_calories ?? 0), 0);
  console.log("  sum of lap total_calories:", total);
}

console.log(`\n=== session fields ===`);
for (const s of data.sessions ?? []) console.log(" ", Object.keys(s).join(", "));

console.log(`\n=== activity / metrics blocks ===`);
for (const key of ["activity", "activity_metrics", "user_metrics", "time_in_zone", "monitors"]) {
  const v = data[key];
  if (v == null) continue;
  const sample = Array.isArray(v) ? v[0] : v;
  if (sample && typeof sample === "object") {
    console.log(`  ${key}: ${Object.keys(sample).join(", ") || "(empty)"}`);
  }
}
