/**
 * Canonical ride representation.
 *
 * Everything downstream assumes streams are resampled to a uniform 1 Hz grid
 * with no gaps — parsers are responsible for producing that shape. Typed arrays
 * throughout, because these are stored as compressed `bytea` columns rather than
 * one row per sample (a 3 h ride is ~11k samples; row-per-sample would exhaust
 * Neon's free tier in a season).
 */
export interface RideStreams {
  /** Seconds since ride start. Uniform 1 Hz after normalisation. */
  time: Float64Array;
  /** Cumulative metres. */
  distance: Float64Array;
  /** Metres. Barometric where the device provides it — see `altitudeSource`. */
  altitude: Float64Array;
  /** Interleaved [lat, lng, lat, lng, …]; length is 2 × sample count. */
  latlng?: Float64Array;
  /** Beats per minute. */
  heartrate?: Float32Array;
  /** Revolutions per minute. Drives coasting detection. */
  cadence?: Float32Array;
  /** Watts, only when a real power meter was present. */
  power?: Float32Array;
  /** Metres per second. */
  speed?: Float32Array;
  /**
   * True when speed was integrated from positions or a distance channel rather
   * than reported by the device.
   *
   * Derived speed is markedly noisier, and because negative power is clamped
   * away that noise only ever adds watts. The estimator smooths it harder.
   */
  speedIsDerived?: boolean;
  /** Degrees Celsius. */
  temperature?: Float32Array;
  /**
   * 1 where the recording was paused and the sample is filler, 0 where it is
   * real data.
   *
   * Normalising to a uniform 1 Hz grid means inventing samples for the time the
   * device was stopped. Those samples must not enter any average: a ride with
   * 80 minutes of cafe stops would otherwise report a mean power a third lower
   * than the rider ever produced.
   */
  paused?: Uint8Array;
}

export type AltitudeSource = "barometric" | "gps" | "dem";

export interface RideMeta {
  /** Barometric altitude gives ~0.5% grade RMSE vs ~2.6% for GPS — this
   *  materially changes how much we trust the power estimate. */
  altitudeSource: AltitudeSource;
  /** Sample count; every present stream has this length (latlng has 2×). */
  n: number;
}

/** Rider + bike parameters for the power model. */
export interface RiderProfile {
  /** Rider mass, kg. */
  riderKg: number;
  /** Bike + kit + bottles, kg. */
  bikeKg: number;
  /**
   * Effective drag area, m². Typical road positions: ~0.34 hoods, ~0.33 drops,
   * ~0.30 low drops. Calibrated per-rider when a power-meter file exists.
   */
  cda: number;
  /** Rolling resistance coefficient. ~0.004–0.005 road tyre on asphalt. */
  crr: number;
  /** Drivetrain efficiency. Martin et al. measured 97.7%; 0.975 is a fair constant. */
  drivetrainEfficiency: number;
  /** Functional threshold power, watts. Drives Intensity and Load. */
  ftp?: number;
  /** Max heart rate, bpm. */
  hrMax?: number;
  /** Resting heart rate, bpm. */
  hrRest?: number;
}

export const DEFAULT_PROFILE: RiderProfile = {
  riderKg: 75,
  bikeKg: 9,
  cda: 0.34,
  crr: 0.0045,
  drivetrainEfficiency: 0.975,
};

/**
 * Why an estimate might be wrong. Wind and drafting are unknowable from a GPS
 * trace, so we surface them rather than pretending to precision we don't have.
 */
export type ConfidenceFlag =
  | "gps-altitude"
  | "hr-power-decoupled"
  | "hr-power-implausible"
  | "glitchy-gps"
  | "sustained-high-speed"
  | "sparse-sampling";

export type ConfidenceLevel = "high" | "moderate" | "low" | "unusable";

export interface PowerConfidence {
  level: ConfidenceLevel;
  flags: ConfidenceFlag[];
  /** Plain-language reason, shown on the ride's confidence chip. */
  summary: string;
}

export interface EstimatedPower {
  /** Watts per sample, clamped at zero. */
  watts: Float32Array;
  confidence: PowerConfidence;
}
