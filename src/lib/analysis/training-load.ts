/**
 * Fitness / Fatigue / Form.
 *
 * Two exponentially-weighted moving averages of daily Load with 42-day and
 * 7-day time constants, and their difference.
 *
 *   Fitness_today = Fitness_yesterday * e^(-1/42) + Load_today * (1 - e^(-1/42))
 *   Fatigue_today = Fatigue_yesterday * e^(-1/7)  + Load_today * (1 - e^(-1/7))
 *   Form_today    = Fitness_yesterday - Fatigue_yesterday
 *
 * Form intentionally uses YESTERDAY's values: today's ride has not made you
 * fitter yet, but it has made you tired, and reading form off post-ride numbers
 * makes every hard day look like a taper.
 *
 * THE bug in this calculation is iterating over activities instead of calendar
 * days. Rest days must contribute a Load of zero or fitness never decays and
 * the chart only ever goes up. `expandDailyLoad` exists to make that impossible.
 */

const FITNESS_TIME_CONSTANT_DAYS = 42;
const FATIGUE_TIME_CONSTANT_DAYS = 7;

const FITNESS_DECAY = Math.exp(-1 / FITNESS_TIME_CONSTANT_DAYS);
const FATIGUE_DECAY = Math.exp(-1 / FATIGUE_TIME_CONSTANT_DAYS);

export interface DatedLoad {
  /** Calendar day as YYYY-MM-DD in the athlete's local timezone. */
  date: string;
  load: number;
}

export interface TrainingLoadPoint {
  date: string;
  load: number;
  fitness: number;
  fatigue: number;
  form: number;
}

/** Days between two YYYY-MM-DD strings, treated as UTC midnights. */
function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Expand sparse per-activity loads into a dense day-by-day series, summing
 * multiple activities on the same day and inserting explicit zeros for rest days.
 */
export function expandDailyLoad(
  entries: DatedLoad[],
  options: { from?: string; to?: string } = {},
): DatedLoad[] {
  if (entries.length === 0) {
    return options.from && options.to ? fillRange(options.from, options.to, new Map()) : [];
  }

  const byDate = new Map<string, number>();
  for (const e of entries) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.load);
  }

  const sorted = [...byDate.keys()].sort();
  const from = options.from ?? sorted[0];
  const to = options.to ?? sorted[sorted.length - 1];
  return fillRange(from, to, byDate);
}

function fillRange(from: string, to: string, byDate: Map<string, number>): DatedLoad[] {
  const span = dayDiff(from, to);
  if (span < 0) return [];
  const out: DatedLoad[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(from, i);
    out.push({ date, load: byDate.get(date) ?? 0 });
  }
  return out;
}

export interface TrainingLoadOptions {
  /** Carry-in values so a windowed view doesn't restart the curve at zero. */
  initialFitness?: number;
  initialFatigue?: number;
  /** Clamp the series to this range; rest days outside activity dates still count. */
  from?: string;
  to?: string;
}

/**
 * Build the fitness/fatigue/form series from per-activity loads.
 *
 * Pass every activity; the function densifies the calendar itself.
 */
export function computeTrainingLoad(
  entries: DatedLoad[],
  options: TrainingLoadOptions = {},
): TrainingLoadPoint[] {
  const daily = expandDailyLoad(entries, { from: options.from, to: options.to });
  let fitness = options.initialFitness ?? 0;
  let fatigue = options.initialFatigue ?? 0;

  return daily.map(({ date, load }) => {
    // Form is read BEFORE today's ride is folded in — see the header note.
    const form = fitness - fatigue;
    fitness = fitness * FITNESS_DECAY + load * (1 - FITNESS_DECAY);
    fatigue = fatigue * FATIGUE_DECAY + load * (1 - FATIGUE_DECAY);
    return { date, load, fitness, fatigue, form };
  });
}

/**
 * Ramp rate: how fast fitness is climbing, in fitness points per week.
 *
 * Sustained values above roughly +5–8/week are where injury and burnout risk
 * start climbing, so this is worth surfacing next to the curve.
 */
export function rampRate(series: TrainingLoadPoint[], windowDays = 7): number {
  if (series.length < 2) return 0;
  const end = series[series.length - 1];
  const startIdx = Math.max(0, series.length - 1 - windowDays);
  const start = series[startIdx];
  const days = dayDiff(start.date, end.date);
  if (days <= 0) return 0;
  return ((end.fitness - start.fitness) / days) * 7;
}

/** Fraction of days in the window carrying any load — a consistency signal. */
export function consistency(series: TrainingLoadPoint[], windowDays = 28): number {
  if (series.length === 0) return 0;
  const window = series.slice(-windowDays);
  const active = window.filter((d) => d.load > 0).length;
  return active / window.length;
}
