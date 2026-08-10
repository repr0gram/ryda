/**
 * Signal helpers shared by the power model and the metrics suite.
 *
 * The ordering rule that matters: smooth elevation, THEN differentiate to get
 * grade. Smoothing grade after computing it from raw elevation leaves the
 * differentiation noise baked in, and grade error is the dominant term in the
 * whole power model.
 */

/**
 * Savitzky-Golay smoothing, quadratic/cubic (they share coefficients).
 *
 * Uses the closed form for the centre row of the least-squares pseudo-inverse:
 *   c_i = 3(3m² + 3m − 1 − 5i²) / ((2m+3)(2m+1)(2m−1))
 * which for m=2 reproduces the textbook 5-point kernel [−3, 12, 17, 12, −3]/35.
 *
 * Edges fall back to a symmetric shrinking window, so the filter never reads
 * outside the array and never flattens the first/last samples to a constant.
 *
 * @param halfWindow m — the window is 2m+1 samples. Must be >= 2.
 */
export function savitzkyGolay(
  input: ArrayLike<number>,
  halfWindow: number,
): Float64Array {
  const n = input.length;
  const out = new Float64Array(n);
  const m = Math.max(2, Math.floor(halfWindow));
  if (n === 0) return out;
  if (n < 2 * m + 1) {
    // Too short to filter meaningfully — pass through.
    for (let i = 0; i < n; i++) out[i] = input[i];
    return out;
  }

  const kernel = sgKernel(m);

  for (let i = 0; i < n; i++) {
    // Shrink the window near the edges so it stays symmetric and in-bounds.
    const reach = Math.min(m, i, n - 1 - i);
    if (reach < 2) {
      out[i] = input[i];
      continue;
    }
    const k = reach === m ? kernel : sgKernel(reach);
    let acc = 0;
    for (let j = -reach; j <= reach; j++) acc += k[j + reach] * input[i + j];
    out[i] = acc;
  }
  return out;
}

const kernelCache = new Map<number, Float64Array>();

function sgKernel(m: number): Float64Array {
  const cached = kernelCache.get(m);
  if (cached) return cached;
  const denom = (2 * m + 3) * (2 * m + 1) * (2 * m - 1);
  const k = new Float64Array(2 * m + 1);
  for (let i = -m; i <= m; i++) {
    k[i + m] = (3 * (3 * m * m + 3 * m - 1 - 5 * i * i)) / denom;
  }
  kernelCache.set(m, k);
  return k;
}

/**
 * Centred moving average over a fixed sample count. Used for speed before
 * differentiation — GPS speed differentiated raw makes the kinetic term
 * dominated by noise.
 */
export function movingAverage(
  input: ArrayLike<number>,
  halfWindow: number,
): Float64Array {
  const n = input.length;
  const out = new Float64Array(n);
  const m = Math.max(0, Math.floor(halfWindow));
  if (m === 0) {
    for (let i = 0; i < n; i++) out[i] = input[i];
    return out;
  }
  // Prefix sums make this O(n) regardless of window size.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + input[i];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - m);
    const hi = Math.min(n - 1, i + m);
    out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
  return out;
}

/**
 * Trailing rolling mean over `window` samples, the shape Weighted Power needs.
 *
 * Partial windows at the head are divided by the FULL window size, not by the
 * count seen so far. That matches GoldenCheetah's circular-buffer implementation
 * and means the series ramps up from zero rather than opening at the first
 * sample's value. The choice is visible on short efforts, so it is deliberate
 * and documented rather than incidental.
 */
export function rollingMeanTrailing(
  input: ArrayLike<number>,
  window: number,
): Float64Array {
  const n = input.length;
  const out = new Float64Array(n);
  const w = Math.max(1, Math.floor(window));
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += input[i];
    if (i >= w) sum -= input[i - w];
    out[i] = sum / w;
  }
  return out;
}

/** Linear interpolation of `ys` sampled at `xs` onto the targets in `at`. */
export function interpolateTo(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  at: ArrayLike<number>,
): Float64Array {
  const out = new Float64Array(at.length);
  const n = xs.length;
  if (n === 0) return out;
  let j = 0;
  for (let i = 0; i < at.length; i++) {
    const x = at[i];
    while (j < n - 2 && xs[j + 1] < x) j++;
    const x0 = xs[j];
    const x1 = xs[j + 1] ?? x0;
    const y0 = ys[j];
    const y1 = ys[j + 1] ?? y0;
    if (x1 === x0) {
      out[i] = y0;
    } else {
      const t = (x - x0) / (x1 - x0);
      out[i] = y0 + t * (y1 - y0);
    }
  }
  return out;
}

/** Element-wise max, used to aggregate cached per-ride power curves. */
export function elementwiseMax(a: Float32Array, b: Float32Array): Float32Array {
  const n = Math.max(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(a[i] ?? 0, b[i] ?? 0);
  }
  return out;
}
