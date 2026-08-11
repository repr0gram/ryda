# Ryda

Ride analysis for people without a power meter.

Strava is where the rides live and where the social layer is. Ryda is the analysis
layer that should sit on top of them: estimated power modelled from physics,
training load that survives scrutiny, a route you can scrub, and a fitness curve
built from your whole history.

It reads your files. It does not talk to the Strava API, for reasons that turned
out to be non-negotiable — see [Why files, not the API](#why-files-not-the-api).

---

## Status

**Working**

- Import `.fit`, `.gpx` and `.tcx`, gzipped or not, straight from a Strava bulk export
- Ride screen — route map coloured by any channel, synchronised charts, scrub, drag-select a range and every statistic recomputes for it
- Library — bulk import, deduplication, delete, recompute
- Trend — fitness / fatigue / form, ramp rate, consistency
- Power — mean-maximal curve, best efforts, FTP estimate, critical power and W′
- Light and dark themes

**Built but not wired up**

- Postgres schema, authentication and a private blob store are provisioned; nothing reads or writes them yet. Rides live only in the browser.
- Share links exist in the schema, not in the app.
- `timeInZones` and `wPrimeBalance` are implemented and tested but have no UI.

**Known to be wrong**

- The power model is uncalibrated. On one real library it estimates a threshold
  around 203 W while cross-checking training load against Strava's Relative
  Effort implies around 158 W. Both cannot be right. See
  [Calibration](#calibration-the-open-problem).

---

## Getting started

Requires Node 20.9+ (developed on 26).

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and drop a ride file on it. Nothing is uploaded —
parsing happens in your browser and rides are stored in IndexedDB on your device.

No environment variables are needed for the analysis features. `DATABASE_URL`
and `BETTER_AUTH_SECRET` are only required once sync and authentication are
wired up.

| script | |
|---|---|
| `npm run dev` | dev server |
| `npm test` | unit tests (72) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | production build |
| `npm run shoot -- /power` | screenshot a route in both themes |
| `node scripts/capture.mjs /ride --upload ride.fit --wait mapIdle` | drive a real file through the real UI |
| `node scripts/inspect-fit.mjs ride.fit` | dump which fields a device actually writes |

---

## Why files, not the API

Strava's API Policy, effective 1 June 2026, makes an API-backed version of this
app impossible to build honestly:

| clause | text | consequence |
|---|---|---|
| §6.2 | "You may not retain Strava Data in your cache for longer than seven (7) days." | A multi-year fitness trend is not permitted. |
| §5.5 | "You may not bulk-export Strava Data, including by accumulating Strava Data through repeated authorized API calls into a corpus, dataset, archive, or database…" | Backfilling your history is not permitted. |
| §5.4 | "You may not process … Strava Data … for the purposes of analytics, analyses…" | The category itself, read literally. |
| §6.6 | "Each Strava user has the right to access and export the user's own Strava data, free of charge… Nothing in this Agreement is intended to limit or condition that user-facing right." | **The way through.** |

The Agreement (§2.3(i)) defines "Strava Data" as data *collected from the Strava
API Materials*. A bulk export is not — it is your data, exercised as a
data-subject right, and §6.6 explicitly declines to condition it.

Files are also simply better. A `.fit` from a head unit carries barometric
altitude, true 1 Hz sampling and cadence; an API round-trip only loses
information.

[intervals.icu](https://intervals.icu) was evaluated as an alternative source and
rejected on two counts, both from its author: it does not estimate power for
rides without a meter, and Strava-sourced activities are not served through its
API at all.

---

## The power model

No power meter, so power is modelled:

```
P = (1/η) · [ m·g·(sinθ + Crr·cosθ) + ½·ρ·CdA·(v + w)² + m_eff·a ] · v
```

Grade error dominates everything else — GPS altitude carries roughly 2.6% RMSE
against 0.5% for barometric, and at 80 kg and 8 m/s a 2.6% error in grade is
~163 W of power that does not exist. So elevation is smoothed with a
Savitzky-Golay filter *before* differentiation, and grade is computed over a
distance window rather than a time window (a time window divides by zero when
you stop).

Things this does that a naive estimator does not:

- **Cadence gates coasting.** `cadence == 0` means the legs are not driving the
  bike, so power is zero. Strava's estimator has no cadence channel.
- **Paused samples are excluded from every average.** Normalising to a uniform
  1 Hz grid means inventing samples for time the device was stopped. One real
  ride had 80 minutes of stops in a 5h47 window; including those zeros reported
  61 W where the physics says ~89 W.
- **Acceleration is differentiated over seven seconds, not one.** Over a ride
  starting and ending at rest, net kinetic work is zero — but negative power is
  clamped away, so symmetric noise in acceleration is a one-way ratchet that
  only adds watts. The size of that bias depends on how noisy the speed channel
  is, which is a property of the *device*, not the rider: the same rider on the
  same roads scored ~40% higher recording on a phone than on a head unit.
- **Physical bounds, not tuning knobs.** Speed above 30 m/s, acceleration above
  2.5 m/s², and estimated power above 2000 W are measurement errors and are
  treated as such.
- **Confidence is reported.** Wind and drafting cannot be recovered from a GPS
  trace, so every ride carries a confidence level and the reasons behind it.

**Estimated power is not reported below five minutes.** Short efforts are
dominated by the acceleration term and by fast descents — with no cadence sensor
there is no way to tell a sprint from freewheeling, and drag at 60 km/h computes
to ~850 W either way. On one real library that produced a "best 5 seconds" of
13.3 W/kg for a rider whose threshold is 1.9 W/kg. That number is not uncertain,
it is fictional, so it is not shown. With a real power meter the full curve
appears.

Expect roughly ±30–40 W even in good conditions.

### Calibration, the open problem

The model is anchored on rider mass, drag area and rolling resistance, and only
mass is known with confidence. Two independent checks currently disagree by
about 45 W on threshold. The cleanest resolution is one ride with a borrowed
power meter, which would let the model fit CdA and Crr by least squares against
measured watts.

---

## Metric names

The algorithms here are the published ones. The names are deliberately not.
"Normalized Power" (US reg. 4450847) and "Training Stress Score" are live
TrainingPeaks trademarks. The mathematics is free to implement; the names are
not. GoldenCheetah renamed its equivalent to *IsoPower* despite being GPL.

| computed | shipped as |
|---|---|
| 30 s rolling mean → 4th power → mean → 4th root | Weighted Power |
| Weighted Power ÷ FTP | Intensity |
| `hours × Intensity² × 100` | Load |
| 42-day and 7-day EWMA of Load, and their difference | Fitness / Fatigue / Form |

---

## Architecture

```
browser ──▶ parse (FIT / GPX / TCX)  ──▶ normalise to 1 Hz  ──▶ estimate power
                                                                     │
                                          IndexedDB ◀── metrics + mean-max curve
```

**Everything runs on the device.** A ride file records where you live and when
you are away from home, so local-by-default is the correct posture — and it means
multi-ride analysis works with no backend, no account and no cost. The schema in
`src/db/schema.ts` mirrors the local store exactly, so adding sync later is a
transport change rather than a rewrite.

Notable decisions:

- **Metrics are denormalised at import.** A season is tens of millions of
  samples; the library and trend never touch them.
- **Mean-maximal curves are cached per ride.** The season envelope is an
  element-wise max over ~1 KB arrays, not a re-scan of raw streams.
- **Sample channels are typed arrays**, stored as `bytea` in Postgres. One row
  per sample would exhaust Neon's free tier within a season.
- **Scrub position lives outside React.** Pointer moves update the map marker and
  chart readouts imperatively, so hovering a 7,000-sample ride does not re-render
  the tree.
- **Rides only.** Nearly half a real Strava export was walks, and bicycle physics
  applied to a walk produces a meaningless number that lands on the fitness
  curve. Non-cycling activities are rejected at import.

### Stack

Next.js 16 · MapLibre GL v6 with [OpenFreeMap](https://openfreemap.org) tiles
(no API key, no request cap) · uPlot · Drizzle + Neon · Better Auth · Vitest.

MapLibre v6 resolves its worker relative to `import.meta.url`, which after
bundling points inside `/_next/static/chunks/` — Next answers that 404 with HTML,
the module worker rejects the MIME type, and the map silently never loads.
`scripts/sync-maplibre-worker.mjs` copies the worker into `public/` and
`setWorkerUrl` points at it. That script runs on `postinstall`, `predev` and
`prebuild`.

---

## Testing

```bash
npm test
```

72 tests. The interesting ones are regressions pinning bugs that failed
*silently* and produced plausible numbers:

- Raw altitude summing reports 770 m of climbing on a ride with 22 m of relief
- Fitness must decay across a rest week (iterating activities instead of calendar days makes it only ever rise)
- Zero-mean speed jitter must not raise average power
- A GPS fix implying 350 kW must not reach the power curve
- Resuming after a pause must not invent a sprint

Tests that need a real ride file are skipped when absent — ride files are
gitignored, since a GPS trace is a home address.

---

## Deployment

Deployed on Vercel. `BETTER_AUTH_SECRET` must be set in the Vercel environment
before authentication will work; `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` are
injected by the Neon and Blob integrations.

Deployment protection is on, which is currently the app's only access control —
it should stay on until authentication is actually wired up.

---

## Licence

Not yet chosen. Note that if this is ever released under AGPL, `@garmin/fitsdk`
cannot be used as a FIT parser; its licence forbids redistribution under any
licence requiring source disclosure. This project uses the MIT-licensed
`fit-file-parser` instead, partly for that reason.
