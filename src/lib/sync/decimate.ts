/**
 * Reduce a ride to something a phone can hold.
 *
 * A four-hour ride is ~14,000 samples across nine channels — roughly 1.2 MB once
 * base64'd, paid on every open over cellular. A phone screen is ~400 points
 * wide, so almost all of that is transmitted to be averaged away on arrival.
 *
 * The subtlety is which sample survives each bucket. Taking every Nth sample
 * throws away extremes, and on modelled power the extremes are most of what the
 * chart is for: a stride-decimated power trace quietly reports a lower peak than
 * the rider produced, which is the same class of dishonesty as reporting a
 * sprint the model cannot see. So each bucket keeps its minimum and its maximum,
 * in the order they occurred, and the envelope survives.
 */

/** Indices to keep, min/max preserved within each bucket. */
export function decimationIndices(
  values: ArrayLike<number>,
  n: number,
  maxSamples: number,
): Int32Array {
  if (n <= maxSamples || maxSamples < 4) return identity(n);

  // Two indices per bucket, so the bucket count is half the sample budget.
  const buckets = Math.max(2, Math.floor(maxSamples / 2));
  const width = n / buckets;
  const keep = new Set<number>();
  keep.add(0);
  keep.add(n - 1);

  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor(b * width);
    const hi = Math.min(n, Math.floor((b + 1) * width));
    if (hi <= lo) continue;
    let minAt = lo;
    let maxAt = lo;
    for (let i = lo; i < hi; i++) {
      if (values[i] < values[minAt]) minAt = i;
      if (values[i] > values[maxAt]) maxAt = i;
    }
    keep.add(minAt);
    keep.add(maxAt);
  }

  return Int32Array.from([...keep].sort((a, b) => a - b));
}

function identity(n: number): Int32Array {
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

/** Gather `indices` out of a channel, preserving its element type. */
export function gather<T extends Float64Array | Float32Array | Uint8Array>(
  channel: T,
  indices: Int32Array,
  stride = 1,
): T {
  const Ctor = channel.constructor as new (length: number) => T;
  const out = new Ctor(indices.length * stride);
  for (let i = 0; i < indices.length; i++) {
    for (let s = 0; s < stride; s++) {
      out[i * stride + s] = channel[indices[i] * stride + s];
    }
  }
  return out;
}
