"use client";

import { useMemo, useState } from "react";
import { CursorStore, type Selection } from "@/lib/cursor-store";
import { estimatePower } from "@/lib/analysis/power";
import { computeRideMetrics } from "@/lib/analysis/metrics";
import { DEFAULT_PROFILE, type RideMeta, type RideStreams } from "@/lib/analysis/types";
import { RideMapLoader } from "./map-loader";
import { StreamChart } from "./stream-chart";
import { ConfidenceChip } from "./confidence-chip";
import { StatRow } from "./stat-row";

const FTP = 250;

type ChannelKey = "power" | "heartrate" | "speed" | "altitude";

const MAP_CHANNELS: { key: ChannelKey; label: string; token: string }[] = [
  { key: "power", label: "Power", token: "--ch-power" },
  { key: "heartrate", label: "Heart rate", token: "--ch-hr" },
  { key: "speed", label: "Speed", token: "--ch-speed" },
  { key: "altitude", label: "Elevation", token: "--ch-elevation-line" },
];

export interface RideViewProps {
  streams: RideStreams;
  meta: RideMeta;
  name: string;
  startedAt: string;
}

export function RideView({ streams, meta, name, startedAt }: RideViewProps) {
  const [xIsDistance, setXIsDistance] = useState(false);
  const [mapChannel, setMapChannel] = useState<ChannelKey>("power");
  const [selection, setSelection] = useState<Selection | null>(null);

  // One store per mounted ride view; charts and the map both talk to it.
  const cursor = useMemo(() => new CursorStore(), []);

  const power = useMemo(
    () => estimatePower(streams, meta, DEFAULT_PROFILE),
    [streams, meta],
  );

  const x = xIsDistance ? streams.distance : streams.time;

  // Selecting a range recomputes every statistic for just that range. This is
  // the thing that makes a ride analyser feel alive, and Strava has no
  // equivalent.
  const metrics = useMemo(() => {
    const from = selection?.from ?? 0;
    const to = selection ? selection.to + 1 : meta.n;
    return computeRideMetrics({
      watts: power.watts.subarray(from, to),
      time: streams.time.subarray(from, to),
      distance: streams.distance.subarray(from, to),
      altitude: streams.altitude.subarray(from, to),
      heartrate: streams.heartrate?.subarray(from, to),
      ftp: FTP,
    });
  }, [power.watts, streams, meta.n, selection]);

  const mapValues =
    mapChannel === "power"
      ? power.watts
      : mapChannel === "heartrate"
        ? (streams.heartrate ?? power.watts)
        : mapChannel === "speed"
          ? (streams.speed ?? power.watts)
          : streams.altitude;

  const mapToken = MAP_CHANNELS.find((c) => c.key === mapChannel)!.token;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4 pb-6">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink">{name}</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {formatDate(startedAt)}
            {selection ? (
              <>
                {" · "}
                <span className="text-ink-secondary">
                  showing a {formatDuration(selection.to - selection.from)} selection
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selection ? (
            <button
              onClick={() => setSelection(null)}
              className="rounded-md border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-3"
            >
              Clear selection
            </button>
          ) : null}
          <Segmented
            options={[
              { value: "time", label: "Time" },
              { value: "distance", label: "Distance" },
            ]}
            value={xIsDistance ? "distance" : "time"}
            onChange={(v) => setXIsDistance(v === "distance")}
          />
        </div>
      </header>

      <StatRow metrics={metrics} ftp={FTP} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section className="flex flex-col overflow-hidden rounded-xl border border-hairline bg-surface-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
            <span className="text-[12px] font-medium text-ink-secondary">Route</span>
            <Segmented
              options={MAP_CHANNELS.map((c) => ({ value: c.key, label: c.label }))}
              value={mapChannel}
              onChange={(v) => setMapChannel(v as ChannelKey)}
            />
          </div>
          {/* Fills the column so the map matches the chart stack's height
              instead of leaving dead space under it. */}
          <div className="min-h-[480px] w-full flex-1">
            <RideMapLoader
              latlng={streams.latlng ?? new Float64Array(0)}
              channel={mapValues}
              distance={streams.distance}
              colorToken={mapToken}
              cursor={cursor}
              selection={selection}
            />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-hairline bg-surface-1">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <span className="text-[12px] font-medium text-ink-secondary">Channels</span>
            <span className="text-[11px] text-ink-muted">
              drag to select a range
            </span>
          </div>

          <StreamChart
            label="Elevation"
            colorToken="--ch-elevation-line"
            x={x}
            y={streams.altitude}
            unit="m"
            fill
            height={78}
            cursor={cursor}
            syncKey="ride"
            onSelect={setSelection}
            xIsDistance={xIsDistance}
          />
          <StreamChart
            label="Power (estimated)"
            colorToken="--ch-power"
            x={x}
            y={power.watts}
            unit="W"
            cursor={cursor}
            syncKey="ride"
            onSelect={setSelection}
            xIsDistance={xIsDistance}
          />
          {streams.heartrate ? (
            <StreamChart
              label="Heart rate"
              colorToken="--ch-hr"
              x={x}
              y={streams.heartrate}
              unit="bpm"
              cursor={cursor}
              syncKey="ride"
              onSelect={setSelection}
              xIsDistance={xIsDistance}
            />
          ) : null}
          {streams.cadence ? (
            <StreamChart
              label="Cadence"
              colorToken="--ch-cadence"
              x={x}
              y={streams.cadence}
              unit="rpm"
              cursor={cursor}
              syncKey="ride"
              onSelect={setSelection}
              xIsDistance={xIsDistance}
            />
          ) : null}
          {streams.speed ? (
            <StreamChart
              label="Speed"
              colorToken="--ch-speed"
              x={x}
              y={streams.speed}
              unit="km/h"
              format={(v) => (v * 3.6).toFixed(1)}
              cursor={cursor}
              syncKey="ride"
              onSelect={setSelection}
              xIsDistance={xIsDistance}
            />
          ) : null}
        </section>
      </div>

      <div className="mt-5">
        <ConfidenceChip confidence={power.confidence} />
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-hairline bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={[
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
            value === o.value
              ? "bg-surface-1 text-ink shadow-[var(--shadow-card)]"
              : "text-ink-muted hover:text-ink-secondary",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
