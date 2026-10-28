import { describe, expect, it } from 'vitest';
import { computeScale } from './calibration';
import { defaultAnalysisConfig } from './config';
import { chooseTimebase, timingStats } from './timebase';

const config = defaultAnalysisConfig();

function times(n: number, fps: number, jitter: (i: number) => number = () => 0): Float64Array {
  return Float64Array.from({ length: n }, (_, i) => i / fps + jitter(i));
}

describe('timingStats', () => {
  it('reports the implied rate, irregular share and dropped frames', () => {
    const t = Array.from(times(241, 240));
    t.splice(100, 1); // a dropped frame doubles one interval
    const stats = timingStats(t, 0.25);
    expect(stats.impliedFps).toBeCloseTo(240, 6);
    expect(stats.droppedFrames).toBe(1);
    expect(stats.irregularShare).toBeCloseTo(1 / 239, 6);
  });
});

describe('chooseTimebase', () => {
  it('uses regular high-rate container timestamps', () => {
    const tb = chooseTimebase(times(1200, 240), 240, config);
    expect(tb.ok && tb.value.source).toBe('container');
    expect(tb.ok && tb.value.fps).toBeCloseTo(240, 6);
  });

  it('falls back to index / declared fps for a file re-timed to 30 fps', () => {
    const tb = chooseTimebase(times(1200, 30), 240, config);
    expect(tb.ok).toBe(true);
    if (!tb.ok) return;
    expect(tb.value.source).toBe('declared');
    expect(tb.value.fps).toBe(240);
    expect(tb.value.timesSec[240]).toBeCloseTo(1, 9);
  });

  it('falls back to the declared rate when high-rate timestamps are irregular', () => {
    const jittery = times(1200, 240, (i) => (i % 10 === 0 ? 0.002 : 0));
    const tb = chooseTimebase(jittery, 240, config);
    expect(tb.ok && tb.value.source).toBe('declared');
  });

  it('fails with timing_invalid when neither is plausible', () => {
    expect(chooseTimebase(times(100, 30), 5000, config)).toEqual({
      ok: false,
      reason: 'timing_invalid',
    });
  });
});

describe('computeScale', () => {
  it('divides the tap distance by the real distance', () => {
    const r = computeScale({ x: 400, y: 900 }, { x: 1400, y: 900 }, 5, 1920, config);
    expect(r.ok && r.value.pxPerM).toBe(200);
    expect(r.ok && r.value.warnings).toEqual([]);
  });

  it('warns when the taps are close together', () => {
    const r = computeScale({ x: 900, y: 900 }, { x: 1200, y: 900 }, 5, 1920, config);
    expect(r.ok && r.value.warnings).toEqual(['taps_close']);
  });

  it('warns when the taps are not level', () => {
    const r = computeScale({ x: 400, y: 900 }, { x: 1400, y: 1050 }, 5, 1920, config);
    expect(r.ok && r.value.warnings).toEqual(['taps_not_level']);
  });

  it('rejects a zero distance or identical taps', () => {
    expect(computeScale({ x: 1, y: 1 }, { x: 2, y: 1 }, 0, 1920, config)).toEqual({
      ok: false,
      reason: 'invalid_distance',
    });
    expect(computeScale({ x: 1, y: 1 }, { x: 1, y: 1 }, 5, 1920, config)).toEqual({
      ok: false,
      reason: 'taps_identical',
    });
  });
});
