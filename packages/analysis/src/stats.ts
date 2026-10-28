// Small numeric helpers. All functions ignore NaN unless stated otherwise.

export function finiteValues(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== undefined && Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function mean(values: ArrayLike<number>): number {
  const v = finiteValues(values);
  if (v.length === 0) return NaN;
  let sum = 0;
  for (const x of v) sum += x;
  return sum / v.length;
}

/** Sample standard deviation (n - 1). NaN for fewer than two values. */
export function sampleSd(values: ArrayLike<number>): number {
  const v = finiteValues(values);
  if (v.length < 2) return NaN;
  const m = mean(v);
  let ss = 0;
  for (const x of v) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (v.length - 1));
}

/** Quantile with linear interpolation between order statistics, q in [0, 1]. */
export function quantile(values: ArrayLike<number>, q: number): number {
  const v = finiteValues(values).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const pos = (v.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = v[lo] ?? NaN;
  const b = v[hi] ?? NaN;
  return a + (b - a) * (pos - lo);
}

export function median(values: ArrayLike<number>): number {
  return quantile(values, 0.5);
}

export interface LineFit {
  /** Intercept. */
  a: number;
  /** Slope. */
  b: number;
  n: number;
}

/** Ordinary least squares fit of y = a + b x over the pairs where both values are finite. */
export function linearFit(xs: ArrayLike<number>, ys: ArrayLike<number>): LineFit | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const len = Math.min(xs.length, ys.length);
  for (let i = 0; i < len; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  if (n < 2) return null;
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const b = (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  return { a, b, n };
}

/** Deterministic PRNG (mulberry32) so that RANSAC and the synthetic generator are repeatable. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample from a uniform source (Box-Muller). */
export function gaussian(random: () => number): number {
  let u = 0;
  while (u <= Number.EPSILON) u = random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export const RAD_TO_DEG = 180 / Math.PI;
