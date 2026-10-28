import { describe, expect, it } from 'vitest';
import { butterworthLowpass, hampel, lowPassSeries, sosFiltFilt, type Biquad } from './filters';
import { gaussian, seededRandom } from './stats';

const FS = 240;

/** Magnitude of the cascade's frequency response at `hz`. */
function magnitude(sections: Biquad[], hz: number, fs: number): number {
  const w = (2 * Math.PI * hz) / fs;
  let mag = 1;
  for (const s of sections) {
    // H(e^jw) = (b0 + b1 e^-jw + b2 e^-2jw) / (1 + a1 e^-jw + a2 e^-2jw)
    const nr = s.b0 + s.b1 * Math.cos(w) + s.b2 * Math.cos(2 * w);
    const ni = -(s.b1 * Math.sin(w) + s.b2 * Math.sin(2 * w));
    const dr = 1 + s.a1 * Math.cos(w) + s.a2 * Math.cos(2 * w);
    const di = -(s.a1 * Math.sin(w) + s.a2 * Math.sin(2 * w));
    mag *= Math.hypot(nr, ni) / Math.hypot(dr, di);
  }
  return mag;
}

function sine(n: number, hz: number, amplitude = 1, phase = 0): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / FS + phase);
  return out;
}

describe('butterworthLowpass', () => {
  it.each([1, 2, 3, 4])('order %i has unit gain at DC and -3 dB at the cut-off', (order) => {
    const sections = butterworthLowpass(order, 12, FS);
    expect(sections).not.toBeNull();
    if (!sections) return;
    expect(sections).toHaveLength(Math.ceil(order / 2));
    expect(magnitude(sections, 0, FS)).toBeCloseTo(1, 10);
    expect(magnitude(sections, 12, FS)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('rolls off at 12 dB per octave for order 2', () => {
    const sections = butterworthLowpass(2, 10, FS);
    if (!sections) throw new Error('expected a filter');
    // |H| = 1 / sqrt(1 + (f/fc)^4) for an analogue Butterworth; the bilinear warp adds a little.
    expect(magnitude(sections, 40, FS)).toBeLessThan(1 / 15);
  });

  it('returns null when the cut-off is not below Nyquist', () => {
    expect(butterworthLowpass(2, 15, 25)).toBeNull();
    expect(butterworthLowpass(2, 0, 240)).toBeNull();
  });
});

describe('sosFiltFilt', () => {
  const sections = butterworthLowpass(2, 10, FS);
  if (!sections) throw new Error('expected a filter');

  it('keeps a constant signal exactly, including at the edges', () => {
    const x = new Float64Array(200).fill(42);
    const y = sosFiltFilt(sections, x);
    for (const v of y) expect(v).toBeCloseTo(42, 9);
  });

  it('keeps a linear ramp, including at the edges', () => {
    const x = new Float64Array(300);
    for (let i = 0; i < x.length; i++) x[i] = 5 + 0.75 * i;
    const y = sosFiltFilt(sections, x, 96);
    for (let i = 0; i < x.length; i++)
      expect(Math.abs((y[i] ?? 0) - (x[i] ?? 0))).toBeLessThan(1e-6);
  });

  it('has zero phase: a slow sine keeps its peaks in place', () => {
    const x = sine(960, 2);
    const y = sosFiltFilt(sections, x, 24);
    // Compare away from the very edges.
    let maxError = 0;
    for (let i = 60; i < 900; i++)
      maxError = Math.max(maxError, Math.abs((y[i] ?? 0) - (x[i] ?? 0)));
    expect(maxError).toBeLessThan(0.01);
    const peak = (s: Float64Array) => {
      let best = 0;
      for (let i = 100; i < 220; i++) if ((s[i] ?? 0) > (s[best] ?? -Infinity)) best = i;
      return best;
    };
    expect(peak(y)).toBe(peak(x));
  });

  it('removes content well above the cut-off', () => {
    const x = sine(960, 60);
    const y = sosFiltFilt(sections, x, 24);
    let maxAbs = 0;
    for (let i = 60; i < 900; i++) maxAbs = Math.max(maxAbs, Math.abs(y[i] ?? 0));
    expect(maxAbs).toBeLessThan(0.01);
  });
});

describe('lowPassSeries', () => {
  it('filters each finite run separately and keeps NaN gaps', () => {
    const x = sine(400, 3, 10);
    for (let i = 150; i < 170; i++) x[i] = NaN;
    const y = lowPassSeries(x, 10, FS, 2);
    for (let i = 150; i < 170; i++) expect(Number.isNaN(y[i])).toBe(true);
    // A 3 Hz sine through two passes of a 10 Hz second-order filter keeps 99.2 percent of its amplitude.
    for (let i = 20; i < 130; i++) expect(Math.abs((y[i] ?? 0) - (x[i] ?? 0))).toBeLessThan(0.1);
  });

  it('leaves the series unchanged when the cut-off is above Nyquist', () => {
    const x = sine(100, 3);
    expect(Array.from(lowPassSeries(x, 50, 60, 2))).toEqual(Array.from(x));
  });
});

describe('hampel', () => {
  it('removes isolated spikes and keeps clean samples', () => {
    const random = seededRandom(7);
    const x = sine(960, 2, 100);
    for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) + gaussian(random) * 0.8;
    const spikes = [50, 233, 400, 401, 777];
    for (const i of spikes) x[i] = (x[i] ?? 0) + 60;
    const y = hampel(x, 7, 3, 2);
    for (const i of spikes) expect(Number.isNaN(y[i])).toBe(true);
    let falsePositives = 0;
    for (let i = 0; i < y.length; i++)
      if (!spikes.includes(i) && Number.isNaN(y[i])) falsePositives++;
    expect(falsePositives).toBeLessThanOrEqual(2);
  });

  it('does not flag the first frames of movement after a still phase', () => {
    // A foot in stance (still) that then accelerates away, sampled at 240 fps.
    const x = new Float64Array(80);
    for (let i = 0; i < x.length; i++) x[i] = i < 40 ? 500 : 500 + 0.6 * (i - 40) ** 2;
    const y = hampel(x, 7, 3, 2);
    for (let i = 0; i < 44; i++) expect(Number.isNaN(y[i])).toBe(false);
  });

  it('ignores NaN and needs at least three samples in the window', () => {
    const x = Float64Array.from([NaN, 1, NaN, NaN, NaN, 100, NaN]);
    const y = hampel(x, 1, 3, 0);
    expect(y[5]).toBe(100);
  });
});
