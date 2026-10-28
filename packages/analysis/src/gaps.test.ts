import { describe, expect, it } from 'vitest';
import { fillGaps, maskByVisibility } from './gaps';

describe('maskByVisibility', () => {
  it('marks samples below the minimum visibility as missing', () => {
    const values = Float64Array.from([1, 2, 3, 4]);
    const visibility = Float64Array.from([0.9, 0.49, 0.5, 0]);
    const out = maskByVisibility(values, visibility, 0.5);
    expect(Array.from(out)).toEqual([1, NaN, 3, NaN]);
  });
});

describe('fillGaps', () => {
  const smooth = (n: number) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = 200 + 50 * Math.sin(i / 15);
    return out;
  };

  it('fills short interior gaps closely and flags them', () => {
    const truth = smooth(200);
    const x = Float64Array.from(truth);
    for (let i = 100; i < 108; i++) x[i] = NaN;
    const { series, filled } = fillGaps(x, 10);
    for (let i = 100; i < 108; i++) {
      expect(Math.abs((series[i] ?? 0) - (truth[i] ?? 0))).toBeLessThan(0.5);
      expect(filled[i]).toBe(1);
    }
    expect(filled[99]).toBe(0);
    expect(filled[108]).toBe(0);
  });

  it('leaves gaps longer than the maximum missing', () => {
    const x = smooth(100);
    for (let i = 40; i < 52; i++) x[i] = NaN;
    const { series, filled } = fillGaps(x, 10);
    for (let i = 40; i < 52; i++) {
      expect(Number.isNaN(series[i])).toBe(true);
      expect(filled[i]).toBe(0);
    }
  });

  it('does not extrapolate missing samples at either end', () => {
    const x = Float64Array.from([NaN, NaN, 3, 4, 5, NaN]);
    const { series } = fillGaps(x, 10);
    expect(Number.isNaN(series[0])).toBe(true);
    expect(Number.isNaN(series[1])).toBe(true);
    expect(Number.isNaN(series[5])).toBe(true);
  });

  it('is monotone inside a gap of monotone data (no overshoot)', () => {
    const x = Float64Array.from([0, 1, 2, NaN, NaN, NaN, NaN, 30, 31, 32]);
    const { series } = fillGaps(x, 10);
    for (let i = 3; i <= 7; i++) {
      expect(series[i] ?? NaN).toBeGreaterThanOrEqual(series[i - 1] ?? NaN);
    }
    for (let i = 3; i < 7; i++) {
      expect(series[i] ?? NaN).toBeGreaterThanOrEqual(2);
      expect(series[i] ?? NaN).toBeLessThanOrEqual(30);
    }
  });

  it('holds a flat line flat across a gap next to a turning point', () => {
    const x = Float64Array.from([5, 6, 7, NaN, NaN, 7, 6, 5]);
    const { series } = fillGaps(x, 10);
    expect(series[3]).toBeCloseTo(7, 9);
    expect(series[4]).toBeCloseTo(7, 9);
  });
});
