"use client";

import { useEffect, useRef, useState } from "react";
import {
  POSITIONS,
  SURFACES,
  saveSettings,
  type RiderSettings,
} from "@/lib/rider-settings";
import { pushSettings } from "@/lib/sync/settings";

/**
 * Calibration controls.
 *
 * Mass and drag area scale estimated power nearly linearly, so this is not a
 * preferences pane — it is the difference between a believable number and a
 * decorative one. Kept one click from the ride so it's obvious when a reading
 * looks wrong.
 */
export function RiderSettingsPanel({
  settings,
  onChange,
}: {
  settings: RiderSettings;
  onChange: (next: RiderSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const update = (patch: Partial<RiderSettings>) => {
    const next = { ...settings, ...patch, configured: true };
    onChange(next);
    saveSettings(next);
    // Fire-and-forget to the account. localStorage stays the copy this browser
    // reads — the app works signed out — but the server needs these to compute
    // estimated power for clients that carry no physics of their own.
    void pushSettings(next);
  };

  const totalKg = settings.riderKg + settings.bikeKg;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={[
          "rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors",
          settings.configured
            ? "border-hairline bg-surface-2 text-ink hover:bg-surface-3"
            : // Unset mass is the single largest source of wrong watts, so it
              // gets the brand colour until it's dealt with.
              "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]",
        ].join(" ")}
      >
        {settings.configured ? `${totalKg} kg · ${settings.ftp} W` : "Set your weight"}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-[300px] rounded-xl border border-hairline bg-surface-1 p-4 shadow-[var(--shadow-pop)]">
          <p className="text-[12px] leading-relaxed text-ink-secondary">
            {settings.configured
              ? "Power is modelled, so these values scale it directly. Mass and position matter more than anything else here."
              : "Until you set these, power is modelled against a default 75 kg rider — so every wattage on screen is a guess about someone else."}
          </p>

          <div className="mt-4 space-y-3.5">
            <Field label="Rider" unit="kg">
              <input
                type="number"
                min={30}
                max={200}
                value={settings.riderKg}
                onChange={(e) => update({ riderKg: Number(e.target.value) })}
                className="w-20 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-right text-[13px] text-ink tabular-nums"
              />
            </Field>

            <Field label="Bike + kit" unit="kg">
              <input
                type="number"
                min={3}
                max={40}
                step={0.5}
                value={settings.bikeKg}
                onChange={(e) => update({ bikeKg: Number(e.target.value) })}
                className="w-20 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-right text-[13px] text-ink tabular-nums"
              />
            </Field>

            <Field label="Threshold" unit="W">
              <input
                type="number"
                min={50}
                max={600}
                value={settings.ftp}
                onChange={(e) => update({ ftp: Number(e.target.value) })}
                className="w-20 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-right text-[13px] text-ink tabular-nums"
              />
            </Field>

            <Field label="Threshold HR" unit="bpm">
              <input
                type="number"
                min={0}
                max={220}
                value={settings.lthr || ""}
                placeholder="—"
                onChange={(e) => update({ lthr: Number(e.target.value) })}
                className="w-20 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-right text-[13px] text-ink tabular-nums"
              />
            </Field>
            <p className="-mt-1 text-[11px] leading-relaxed text-ink-muted">
              Your average heart rate over a hard hour. Unlocks heart-rate zones,
              which are measured rather than estimated — so on a bike with no power
              meter they are the more trustworthy half of this screen.
            </p>

            <div>
              <div className="text-[12px] text-ink-secondary">Riding position</div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {POSITIONS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => update({ positionId: p.id })}
                    title={p.hint}
                    className={[
                      "rounded-md border px-2 py-1.5 text-[12px] transition-colors",
                      settings.positionId === p.id
                        ? "border-[var(--brand)] bg-surface-2 text-ink"
                        : "border-hairline bg-surface-2 text-ink-muted hover:text-ink-secondary",
                    ].join(" ")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[12px] text-ink-secondary">Tyres</div>
              <div className="mt-1.5 flex flex-col gap-1.5">
                {SURFACES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => update({ surfaceId: s.id })}
                    className={[
                      "rounded-md border px-2 py-1.5 text-left text-[12px] transition-colors",
                      settings.surfaceId === s.id
                        ? "border-[var(--brand)] bg-surface-2 text-ink"
                        : "border-hairline bg-surface-2 text-ink-muted hover:text-ink-secondary",
                    ].join(" ")}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  unit,
  children,
}: {
  label: string;
  unit: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-ink-secondary">{label}</span>
      <span className="flex items-center gap-1.5">
        {children}
        <span className="w-6 text-[11px] text-ink-muted">{unit}</span>
      </span>
    </label>
  );
}
