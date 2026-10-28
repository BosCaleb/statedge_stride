import { median } from './stats';

// Spike removal and zero-phase low-pass filtering of landmark series. Series use NaN for
// missing samples; filtering runs separately over each contiguous run of finite samples.

/** One second-order section, normalised so that a0 = 1. */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

const MAD_TO_SD = 1.4826;

/**
 * Hampel filter. A sample further than `nSigmas` robust standard deviations from the median of
 * its window is a spike and becomes NaN, so that gap filling can replace it.
 *
 * Landmarks of a running athlete trend strongly (several pixels per frame), which would inflate
 * the window's deviation and hide spikes, so each window is first detrended by the median of its
 * first differences, a slope estimate that isolated spikes cannot move. `minScale` puts a floor
 * under the robust deviation so that a near-constant run (a foot in stance) does not turn the
 * first frames of real movement into "spikes".
 */
export function hampel(
  series: Float64Array,
  halfWindow: number,
  nSigmas: number,
  minScale: number,
): Float64Array {
  const out = Float64Array.from(series);
  const n = series.length;
  const diffs: number[] = [];
  const detrended: number[] = [];
  const deviations: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = series[i] ?? NaN;
    if (!Number.isFinite(xi)) continue;
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);
    diffs.length = 0;
    for (let j = lo; j < hi; j++) {
      const a = series[j] ?? NaN;
      const b = series[j + 1] ?? NaN;
      if (Number.isFinite(a) && Number.isFinite(b)) diffs.push(b - a);
    }
    const slope = diffs.length > 0 ? median(diffs) : 0;
    detrended.length = 0;
    for (let j = lo; j <= hi; j++) {
      const v = series[j] ?? NaN;
      if (Number.isFinite(v)) detrended.push(v - slope * (j - i));
    }
    if (detrended.length < 3) continue;
    const med = median(detrended);
    deviations.length = 0;
    for (const v of detrended) deviations.push(Math.abs(v - med));
    const scale = Math.max(MAD_TO_SD * median(deviations), minScale);
    if (Math.abs(xi - med) > nSigmas * scale) out[i] = NaN;
  }
  return out;
}

/**
 * Digital Butterworth low-pass filter of the given order as second-order sections, designed with
 * the bilinear transform and a pre-warped cut-off. Returns null when the cut-off is not below the
 * Nyquist frequency, in which case the caller leaves the series unfiltered.
 */
export function butterworthLowpass(
  order: number,
  cutoffHz: number,
  sampleRateHz: number,
): Biquad[] | null {
  if (!(order >= 1) || !(cutoffHz > 0) || !(sampleRateHz > 0)) return null;
  if (cutoffHz >= 0.49 * sampleRateHz) return null;
  const k = Math.tan((Math.PI * cutoffHz) / sampleRateHz);
  const k2 = k * k;
  const sections: Biquad[] = [];
  for (let i = 1; i <= Math.floor(order / 2); i++) {
    // Angle of the i-th analogue pole pair from the negative real axis.
    const theta = (Math.PI * (order + 1 - 2 * i)) / (2 * order);
    const q = 1 / (2 * Math.cos(theta));
    const norm = 1 / (1 + k / q + k2);
    const b0 = k2 * norm;
    sections.push({
      b0,
      b1: 2 * b0,
      b2: b0,
      a1: 2 * (k2 - 1) * norm,
      a2: (1 - k / q + k2) * norm,
    });
  }
  if (order % 2 === 1) {
    const norm = 1 / (1 + k);
    sections.push({ b0: k * norm, b1: k * norm, b2: 0, a1: (k - 1) * norm, a2: 0 });
  }
  return sections;
}

/** Filters `x` in place through the cascade, starting from steady state for `x[0]`. */
function sosFilterInPlace(sections: Biquad[], x: Float64Array): void {
  if (x.length === 0) return;
  let level = x[0] ?? 0;
  for (const s of sections) {
    // Steady-state initial conditions of the transposed direct form II for a constant input.
    const gain = (s.b0 + s.b1 + s.b2) / (1 + s.a1 + s.a2);
    let z1 = (s.b1 + s.b2 - (s.a1 + s.a2) * gain) * level;
    let z2 = (s.b2 - s.a2 * gain) * level;
    level *= gain;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i] ?? 0;
      const yi = s.b0 * xi + z1;
      z1 = s.b1 * xi - s.a1 * yi + z2;
      z2 = s.b2 * xi - s.a2 * yi;
      x[i] = yi;
    }
  }
}

/**
 * Zero-phase filtering: forward and backward passes over an odd (point-reflected) extension of
 * the signal, with steady-state initial conditions, as in SciPy's sosfiltfilt.
 */
export function sosFiltFilt(sections: Biquad[], x: Float64Array, padLength?: number): Float64Array {
  const n = x.length;
  if (n < 2 || sections.length === 0) return Float64Array.from(x);
  const pad = Math.min(n - 1, padLength ?? 3 * (2 * sections.length + 1));
  const ext = new Float64Array(n + 2 * pad);
  const first = x[0] ?? 0;
  const last = x[n - 1] ?? 0;
  for (let i = 0; i < pad; i++) ext[i] = 2 * first - (x[pad - i] ?? 0);
  ext.set(x, pad);
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * last - (x[n - 2 - i] ?? 0);
  sosFilterInPlace(sections, ext);
  ext.reverse();
  sosFilterInPlace(sections, ext);
  ext.reverse();
  return ext.slice(pad, pad + n);
}

/**
 * Zero-phase Butterworth low-pass over each contiguous run of finite samples. Runs too short to
 * filter meaningfully are left as they are. The reflected padding is four cut-off periods (or the
 * run length), which keeps the edge error on a ramp below a micro-pixel; SciPy's default of
 * 3 * (2 * sections + 1) samples leaves errors of a quarter pixel at 240 fps.
 */
export function lowPassSeries(
  series: Float64Array,
  cutoffHz: number,
  sampleRateHz: number,
  order: number,
): Float64Array {
  const sections = butterworthLowpass(order, cutoffHz, sampleRateHz);
  const out = Float64Array.from(series);
  if (!sections) return out;
  const pad = Math.ceil((4 * sampleRateHz) / cutoffHz);
  let start = -1;
  for (let i = 0; i <= series.length; i++) {
    const finite = i < series.length && Number.isFinite(series[i] ?? NaN);
    if (finite && start < 0) start = i;
    if (!finite && start >= 0) {
      if (i - start >= 4) out.set(sosFiltFilt(sections, series.subarray(start, i), pad), start);
      start = -1;
    }
  }
  return out;
}
