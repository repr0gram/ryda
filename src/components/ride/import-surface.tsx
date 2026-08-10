"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ParsedRide } from "@/lib/ingest/fit";
import { importRide } from "@/lib/store/import";
import { DEFAULT_SETTINGS, loadSettings, type RiderSettings } from "@/lib/rider-settings";
import { FileDrop } from "./file-drop";
import { RideView } from "./ride-view";

type SaveState = "idle" | "saving" | "saved" | "updated" | "error";

export function ImportSurface() {
  const [ride, setRide] = useState<ParsedRide | null>(null);
  const [settings, setSettings] = useState<RiderSettings>(DEFAULT_SETTINGS);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => setSettings(loadSettings()), []);

  async function save() {
    if (!ride) return;
    setSaveState("saving");
    try {
      const result = await importRide(ride, settings);
      setSaveState(result.replaced ? "updated" : "saved");
    } catch {
      setSaveState("error");
    }
  }

  if (!ride) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-20">
        <h1 className="text-2xl font-medium tracking-tight text-ink">
          Ride analysis that tells you something
        </h1>
        <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-secondary">
          Drop a ride file to see estimated power, weighted power, decoupling and a
          route you can scrub. No power meter needed — power is modelled from
          gradient, speed and mass, with cadence separating coasting from pedalling.
        </p>
        <div className="mt-8">
          <FileDrop onRide={setRide} />
        </div>
        <p className="mt-6 text-[12px] leading-relaxed text-ink-muted">
          Importing many rides at once? Use the{" "}
          <Link href="/library" className="text-ink-secondary underline">
            library
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-3 px-6 pt-4">
        <p className="text-[12px] text-ink-muted">
          {ride.devices.length > 0 ? `Recorded on ${ride.devices.join(" + ")}. ` : ""}
          Read in your browser — nothing was uploaded.
        </p>
        <div className="flex items-center gap-2">
          {saveState === "saved" || saveState === "updated" ? (
            <span className="text-[12px] text-ink-secondary">
              {saveState === "updated" ? "Updated in library" : "Saved to library"} ·{" "}
              <Link href="/trend" className="underline">
                see trend
              </Link>
            </span>
          ) : (
            <button
              onClick={save}
              disabled={saveState === "saving"}
              className="rounded-md bg-[var(--brand)] px-3 py-1.5 text-[12px] font-medium text-[var(--brand-contrast)] disabled:opacity-60"
            >
              {saveState === "saving" ? "Saving…" : "Save to library"}
            </button>
          )}
          {saveState === "error" ? (
            <span className="text-[12px]" style={{ color: "var(--status-critical)" }}>
              Could not save
            </span>
          ) : null}
          <button
            onClick={() => {
              setRide(null);
              setSaveState("idle");
            }}
            className="rounded-md border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-3"
          >
            Open another
          </button>
        </div>
      </div>
      <RideView
        streams={ride.streams}
        meta={ride.meta}
        name={ride.name}
        startedAt={ride.startedAt}
      />
    </div>
  );
}
