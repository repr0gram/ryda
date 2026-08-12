"use client";

import { useEffect, useState } from "react";
import { loadSettings } from "@/lib/rider-settings";
import { listRides } from "@/lib/store/rides";
import { fetchRemoteRides, sync, type SyncProgress, type SyncResult } from "@/lib/sync/client";

export function SyncPanel() {
  const [local, setLocal] = useState<number | null>(null);
  const [remote, setRemote] = useState<number | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [l, r] = await Promise.all([listRides(), fetchRemoteRides()]);
      setLocal(l.length);
      setRemote(r.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not reach the server");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function run() {
    setError(null);
    setResult(null);
    try {
      const outcome = await sync(loadSettings(), setProgress);
      setResult(outcome);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "sync failed");
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-hairline bg-surface-1 p-5">
      <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Sync</h2>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px]">
        <span className="text-ink-secondary">
          In this browser <span className="text-ink tabular-nums">{local ?? "…"}</span>
        </span>
        <span className="text-ink-secondary">
          On the server <span className="text-ink tabular-nums">{remote ?? "…"}</span>
        </span>
      </div>

      <p className="mt-2 max-w-prose text-[12px] leading-relaxed text-ink-secondary">
        Sync copies rides in both directions and matches them by start time and
        duration, so importing the same file on two devices converges on one ride
        rather than two. Rides pulled down are re-analysed here with your current
        weight and threshold, not trusted from the server.
      </p>

      <button
        onClick={run}
        disabled={progress !== null}
        className="mt-4 rounded-md bg-[var(--brand)] px-3 py-2 text-[13px] font-medium text-[var(--brand-contrast)] transition-opacity disabled:opacity-60"
      >
        {progress ? "Syncing…" : "Sync now"}
      </button>

      {progress ? (
        <p className="mt-3 text-[12px] text-ink-muted">
          {progress.phase === "push" ? "Uploading" : "Downloading"} {progress.done}/
          {progress.total} — {progress.name}
        </p>
      ) : null}

      {result ? (
        <p className="mt-3 text-[12px] text-ink-secondary">
          Uploaded {result.pushed}, downloaded {result.pulled}.
          {result.failed.length > 0 ? (
            <span style={{ color: "var(--status-warning)" }}>
              {" "}
              {result.failed.length} failed: {result.failed[0].reason}.
            </span>
          ) : null}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-[12px]" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
