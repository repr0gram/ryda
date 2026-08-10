/**
 * W′ balance — how much of your finite work capacity above critical power is
 * left at each moment.
 *
 * Uses the Froncioni–Skiba–Clarke differential form (Skiba et al., EJAP 2015):
 * above CP you spend W′ at the rate of the excess; below CP you refill it in
 * proportion to how far below you are and how depleted you already are. It is
 * O(n), needs no recovery time constant, and is the most recent of the three
 * published formulations.
 *
 * This is the metric that explains why the fourth climb hurts more than the
 * first at identical power.
 */

export interface WPrimeBalanceResult {
  /** Joules of W′ remaining at each sample. */
  balance: Float32Array;
  /** Lowest point reached — how close the ride came to full depletion. */
  minimum: number;
  /** Fraction of W′ consumed at the deepest point, 0..1. */
  maxDepletion: number;
}

/**
 * @param watts   Power per sample, 1 Hz.
 * @param cp      Critical power, watts.
 * @param wPrime  Work capacity above CP, joules (typically ~20,000).
 */
export function wPrimeBalance(
  watts: ArrayLike<number>,
  cp: number,
  wPrime: number,
): WPrimeBalanceResult {
  const n = watts.length;
  const balance = new Float32Array(n);
  if (n === 0 || !(wPrime > 0) || !(cp > 0)) {
    return { balance, minimum: wPrime, maxDepletion: 0 };
  }

  let current = wPrime;
  let minimum = wPrime;

  for (let i = 0; i < n; i++) {
    const p = watts[i];
    if (p < cp) {
      // Recovery scales with the remaining deficit, so a nearly-full tank
      // refills slowly and an empty one refills fast.
      current = current + (cp - p) * ((wPrime - current) / wPrime);
    } else {
      current = current - (p - cp);
    }
    // Can't bank more than you have, and full depletion is the floor.
    if (current > wPrime) current = wPrime;
    if (current < 0) current = 0;
    balance[i] = current;
    if (current < minimum) minimum = current;
  }

  return { balance, minimum, maxDepletion: (wPrime - minimum) / wPrime };
}
