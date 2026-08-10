import { DEFAULT_PROFILE, type RiderProfile } from "@/lib/analysis/types";

/**
 * Rider settings.
 *
 * Mass and drag area scale the power estimate almost linearly, so leaving them
 * at defaults is the difference between a useful number and a decorative one.
 * These live in localStorage until there's a database; the shape matches what
 * the settings table will store.
 */
export const RIDER_SETTINGS_KEY = "ryda-rider";

/**
 * Drag area presets, m². Anchored on wind-tunnel work (Barry et al. 2015)
 * where an upright-hoods position measures ~0.34 m², with the other positions
 * scaled by the measured power ratios from the same study.
 */
export const POSITIONS: { id: string; label: string; cda: number; hint: string }[] = [
  { id: "upright", label: "Upright", cda: 0.4, hint: "sitting up, hands on the tops" },
  { id: "hoods", label: "Hoods", cda: 0.34, hint: "the default road position" },
  { id: "drops", label: "Drops", cda: 0.31, hint: "hands in the drops" },
  { id: "aero", label: "Aero", cda: 0.28, hint: "low drops or clip-on bars" },
];

/** Rolling resistance presets. Road tyres on asphalt sit around 0.004–0.005. */
export const SURFACES: { id: string; label: string; crr: number }[] = [
  { id: "fast-road", label: "Fast road tyres", crr: 0.004 },
  { id: "road", label: "Road tyres", crr: 0.005 },
  { id: "gravel", label: "Gravel tyres", crr: 0.008 },
];

export interface RiderSettings {
  riderKg: number;
  bikeKg: number;
  positionId: string;
  surfaceId: string;
  ftp: number;
}

export const DEFAULT_SETTINGS: RiderSettings = {
  riderKg: 75,
  bikeKg: 9,
  positionId: "hoods",
  surfaceId: "road",
  ftp: 250,
};

export function toProfile(settings: RiderSettings): RiderProfile {
  const position = POSITIONS.find((p) => p.id === settings.positionId);
  const surface = SURFACES.find((s) => s.id === settings.surfaceId);
  return {
    ...DEFAULT_PROFILE,
    riderKg: settings.riderKg,
    bikeKg: settings.bikeKg,
    cda: position?.cda ?? DEFAULT_PROFILE.cda,
    crr: surface?.crr ?? DEFAULT_PROFILE.crr,
    ftp: settings.ftp,
  };
}

export function loadSettings(): RiderSettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(RIDER_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<RiderSettings>;
    return sanitise({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: RiderSettings): void {
  try {
    localStorage.setItem(RIDER_SETTINGS_KEY, JSON.stringify(sanitise(settings)));
  } catch {
    // Private mode — settings just won't persist.
  }
}

/** Clamp to physically sensible ranges so a typo can't produce nonsense watts. */
function sanitise(s: RiderSettings): RiderSettings {
  const clamp = (v: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    riderKg: clamp(s.riderKg, 30, 200, DEFAULT_SETTINGS.riderKg),
    bikeKg: clamp(s.bikeKg, 3, 40, DEFAULT_SETTINGS.bikeKg),
    positionId: POSITIONS.some((p) => p.id === s.positionId)
      ? s.positionId
      : DEFAULT_SETTINGS.positionId,
    surfaceId: SURFACES.some((x) => x.id === s.surfaceId)
      ? s.surfaceId
      : DEFAULT_SETTINGS.surfaceId,
    ftp: clamp(s.ftp, 50, 600, DEFAULT_SETTINGS.ftp),
  };
}
