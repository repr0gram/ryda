"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { importFiles, recomputeAll, type ImportOutcome } from "@/lib/store/import";
import { clearAll, deleteRide, listRides, type RideSummary } from "@/lib/store/rides";
import { DEFAULT_SETTINGS, loadSettings } from "@/lib/rider-settings";
import { energyFor } from "@/lib/analysis/metrics";
import { pushQuietly } from "@/lib/sync/client";

export function LibraryView() {
  const [rides, setRides] = useState<RideSummary[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [dragging, setDragging] = useState(false);
  const [recomputing, setRecomputing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listRides()
      .then(setRides)
      .catch(() => setRides([]));
  }, []);

  useEffect(refresh, [refresh]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const usable = files.filter((f) => /\.(fit|gpx|tcx)(\.gz)?$/i.test(f.name));
      if (usable.length === 0) return;
      setOutcome(null);
      setProgress({ done: 0, total: usable.length });
      const settings = loadSettings() ?? DEFAULT_SETTINGS;
      const result = await importFiles(usable, settings, (p) =>
        setProgress({ done: p.index + 1, total: p.total }),
      );
      setProgress(null);
      setOutcome(result);
      refresh();
      // Carry the new rides up straight away, so "imported" and "on my phone"
      // are the same event rather than two the rider has to connect.
      void pushQuietly(settings);
    },
    [refresh],
  );

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <header className="pb-5">
        <h1 className="text-xl font-medium tracking-tight text-ink">Library</h1>
        <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-muted">
          Rides are stored in this browser, not on a server. Drop a whole folder from
          a Strava bulk export — re-importing the same ride updates it rather than
          duplicating it.
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={[
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-4 transition-colors",
          dragging
            ? "border-[var(--brand)] bg-surface-2"
            : "border-[var(--line-axis)] bg-surface-1",
        ].join(" ")}
      >
        <p className="text-[13px] text-ink-secondary">
          {progress
            ? `Importing ${progress.done} of ${progress.total}…`
            : "Drop .fit or .gpx files here"}
        </p>
        <div className="flex items-center gap-2">
          {rides && rides.length > 0 ? (
            <button
              onClick={async () => {
                setRecomputing("Recomputing…");
                const r = await recomputeAll(loadSettings() ?? DEFAULT_SETTINGS, (d, t) =>
                  setRecomputing(`Recomputing ${d} of ${t}…`),
                );
                setRecomputing(null);
                setOutcome({ added: 0, replaced: r.updated, skipped: [], failed: [] });
                refresh();
              }}
              disabled={recomputing !== null || progress !== null}
              title="Re-run the power model and metrics over the rides already stored here"
              className="rounded-md border border-hairline bg-surface-2 px-3 py-2 text-[12px] font-medium text-ink transition-colors hover:bg-surface-3 disabled:opacity-60"
            >
              {recomputing ?? "Recompute all"}
            </button>
          ) : null}
          <button
            onClick={() => inputRef.current?.click()}
            disabled={progress !== null}
            className="rounded-md bg-[var(--brand)] px-3.5 py-2 text-[13px] font-medium text-[var(--brand-contrast)] disabled:opacity-60"
          >
            Choose files
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".fit,.gpx,.tcx,.gz"
          multiple
          className="sr-only"
          onChange={(e) => {
            void handleFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {outcome ? (
        <div className="mt-3 rounded-lg border border-hairline bg-surface-1 px-4 py-3 text-[13px]">
          <span className="text-ink">
            {outcome.added} added, {outcome.replaced} updated
            {outcome.skipped.length > 0
              ? `, ${outcome.skipped.length} not rides`
              : ""}
            {outcome.failed.length > 0 ? `, ${outcome.failed.length} unreadable` : ""}.
          </span>
          {outcome.skipped.length > 0 ? (
            <p className="mt-1 text-[12px] text-ink-muted">
              Walks, runs and anything else were left out — the power model is
              bicycle physics and would report nonsense for them.
            </p>
          ) : null}
          {outcome.failed.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-[12px] text-ink-muted">
              {outcome.failed.slice(0, 5).map((f) => (
                <li key={f.file}>
                  {f.file} — {f.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {rides && rides.length > 0 ? (
        <div className="mt-4 flex justify-end">
          <button
            onClick={async () => {
              if (
                !confirm(
                  `Remove all ${rides.length} stored rides from this browser? The original files are untouched.`,
                )
              ) {
                return;
              }
              await clearAll();
              setOutcome(null);
              refresh();
            }}
            className="text-[12px] text-ink-muted transition-colors hover:text-[var(--status-critical)]"
          >
            Clear library
          </button>
        </div>
      ) : null}

      <div className="mt-6">
        {rides === null ? (
          <p className="text-[13px] text-ink-muted">Loading…</p>
        ) : rides.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing saved yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-hairline">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2 font-medium">Ride</th>
                  <th className="px-3 py-2 text-right font-medium">Distance</th>
                  <th className="px-3 py-2 text-right font-medium">Climb</th>
                  <th className="px-3 py-2 text-right font-medium">Moving</th>
                  <th className="px-3 py-2 text-right font-medium">Power</th>
                  <th className="px-3 py-2 text-right font-medium">Energy</th>
                  <th className="px-3 py-2 text-right font-medium">Load</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rides.map((r) => (
                  <tr key={r.id} className="border-t border-hairline bg-surface-1">
                    <td className="px-4 py-2.5">
                      <Link
                        href={{ pathname: "/ride", query: { id: r.id } }}
                        className="text-ink hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="text-[11px] text-ink-muted">
                        {new Date(r.startedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        {r.confidence !== "high" ? ` · ${r.confidence} confidence` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                      {(r.distanceMeters / 1000).toFixed(1)} km
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                      {Math.round(r.elevationGainMeters)} m
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                      {formatClock(r.movingSeconds)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                      {Math.round(r.weightedPower)} W
                    </td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums text-ink-secondary"
                      title={
                        r.reportedCalories
                          ? "Recorded by the device"
                          : "Derived from work done — this file carried no calorie figure"
                      }
                    >
                      {Math.round(
                        energyFor(r.reportedCalories, r.meanPower, r.movingSeconds).calories,
                      ).toLocaleString("en-GB")}
                      {/* A derived figure counts only work at the pedals, so it
                          reads far lower than a device's. Marked rather than
                          silently mixed into the same column. */}
                      {r.reportedCalories ? "" : "*"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                      {Math.round(r.load)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={async () => {
                          await deleteRide(r.id);
                          refresh();
                        }}
                        aria-label={`Delete ${r.name}`}
                        className="text-[12px] text-ink-muted transition-colors hover:text-[var(--status-critical)]"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}m`;
}
