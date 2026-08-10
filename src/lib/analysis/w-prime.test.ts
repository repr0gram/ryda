import { describe, expect, test } from "vitest";
import { wPrimeBalance } from "./w-prime";

const CP = 250;
const W_PRIME = 20000;

describe("wPrimeBalance", () => {
  test("stays full when riding below critical power", () => {
    const watts = Float32Array.from({ length: 600 }, () => 200);
    const { balance, maxDepletion } = wPrimeBalance(watts, CP, W_PRIME);
    expect(maxDepletion).toBe(0);
    for (const b of balance) expect(b).toBe(W_PRIME);
  });

  test("depletes at the rate of the excess above CP", () => {
    // 100 W over CP for 60 s should cost ~6 kJ of W'.
    const watts = Float32Array.from({ length: 60 }, () => 350);
    const { balance } = wPrimeBalance(watts, CP, W_PRIME);
    expect(W_PRIME - balance[59]).toBeCloseTo(6000, -2);
  });

  test("cannot go below zero", () => {
    const watts = Float32Array.from({ length: 600 }, () => 600);
    const { balance, minimum } = wPrimeBalance(watts, CP, W_PRIME);
    expect(minimum).toBe(0);
    for (const b of balance) expect(b).toBeGreaterThanOrEqual(0);
  });

  test("recovers when power drops back under CP, but not instantly", () => {
    const watts = new Float32Array(1200);
    for (let i = 0; i < 1200; i++) watts[i] = i < 120 ? 400 : 150;
    const { balance } = wPrimeBalance(watts, CP, W_PRIME);
    const afterEffort = balance[119];
    expect(afterEffort).toBeLessThan(W_PRIME);
    expect(balance[300]).toBeGreaterThan(afterEffort); // refilling
    expect(balance[300]).toBeLessThan(W_PRIME); // but not yet full
    expect(balance[1199]).toBeGreaterThan(balance[300]);
  });

  test("repeated efforts deplete further each time", () => {
    // The point of the metric: identical efforts cost more as the ride goes on.
    const watts = new Float32Array(1800);
    for (let i = 0; i < 1800; i++) {
      const inEffort = i % 300 < 60;
      watts[i] = inEffort ? 400 : 220;
    }
    const { balance } = wPrimeBalance(watts, CP, W_PRIME);
    const firstTrough = balance[59];
    const lastTrough = balance[1559];
    expect(lastTrough).toBeLessThan(firstTrough);
  });

  test("degrades safely on nonsense parameters", () => {
    const watts = Float32Array.from({ length: 10 }, () => 300);
    expect(wPrimeBalance(watts, 0, W_PRIME).maxDepletion).toBe(0);
    expect(wPrimeBalance(watts, CP, 0).maxDepletion).toBe(0);
    expect(wPrimeBalance(new Float32Array(0), CP, W_PRIME).balance).toHaveLength(0);
  });
});
