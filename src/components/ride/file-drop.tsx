"use client";

import { useCallback, useRef, useState } from "react";
import type { ParsedRide } from "@/lib/ingest/fit";

/**
 * Parsing happens in the browser.
 *
 * The file never leaves the machine until the user chooses to save it, which is
 * the right default for data that encodes where someone lives. It also means
 * the whole import path works before any storage exists.
 */
export function FileDrop({
  onRide,
  compact = false,
}: {
  onRide: (ride: ParsedRide) => void;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".fit")) {
          const { parseFit } = await import("@/lib/ingest/fit");
          onRide(await parseFit(await file.arrayBuffer()));
        } else if (lower.endsWith(".gpx")) {
          const { parseGpx } = await import("@/lib/ingest/gpx");
          onRide(parseGpx(await file.text()));
        } else {
          throw new Error(
            `${file.name} isn't a format I can read yet. Drop a .fit or .gpx file.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "That file could not be read.");
      } finally {
        setBusy(false);
      }
    },
    [onRide],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  return (
    <div className={compact ? "" : "mx-auto w-full max-w-2xl px-6 py-24"}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          "rounded-xl border border-dashed transition-colors",
          compact ? "px-4 py-5" : "px-8 py-14 text-center",
          dragging
            ? "border-[var(--brand)] bg-surface-2"
            : "border-[var(--line-axis)] bg-surface-1",
        ].join(" ")}
      >
        {!compact && (
          <h2 className="text-lg font-medium tracking-tight text-ink">
            {busy ? "Reading your ride…" : "Drop a ride file"}
          </h2>
        )}
        <p
          className={[
            "text-[13px] leading-relaxed text-ink-secondary",
            compact ? "" : "mx-auto mt-2 max-w-md",
          ].join(" ")}
        >
          <span className="font-mono text-[12px] text-ink">.fit</span> or{" "}
          <span className="font-mono text-[12px] text-ink">.gpx</span>. Everything is
          read in your browser — nothing is uploaded.
        </p>

        <div className={compact ? "mt-3" : "mt-5"}>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-md bg-[var(--brand)] px-3.5 py-2 text-[13px] font-medium text-[var(--brand-contrast)] disabled:opacity-60"
          >
            {busy ? "Reading…" : "Choose a file"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".fit,.gpx"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {error ? (
          <p
            className={[
              "text-[13px] leading-relaxed",
              compact ? "mt-3" : "mx-auto mt-4 max-w-md",
            ].join(" ")}
            style={{ color: "var(--status-critical)" }}
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
