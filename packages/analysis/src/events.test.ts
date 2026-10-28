import { describe, expect, it } from 'vitest';
import { defaultAnalysisConfig } from './config';
import { findExtrema, fitGroundLine } from './events';
import { generateGait, SPRINT_GAIT } from './testing/syntheticGait';
import { runSynthetic } from './testing/runSynthetic';

describe('detectEvents on synthetic running', () => {
  it.each([
    ['distance', {}],
    ['sprint', SPRINT_GAIT],
  ] as const)('finds every %s stance on the right side, in alternation', (mode, options) => {
    const clip = generateGait({ ...options, noisePx: 1 });
    const { result } = runSynthetic(clip, { mode });
    expect(result.events).toHaveLength(clip.truth.events.length);
    for (let i = 0; i < result.events.length; i++) {
      const found = result.events[i];
      const truth = clip.truth.events[i];
      expect(found?.side).toBe(truth?.side);
      // Initial contact within 15 ms, toe-off within 20 ms (smoothing bias included).
      expect(Math.abs((found?.icTimeSec ?? 0) - (truth?.icTimeSec ?? 0))).toBeLessThan(0.015);
      expect(Math.abs((found?.toTimeSec ?? 0) - (truth?.toTimeSec ?? 0))).toBeLessThan(0.02);
    }
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]?.side).not.toBe(result.events[i - 1]?.side);
    }
  });

  it('cross-checks most events with the secondary method on clean data', () => {
    const { result } = runSynthetic(generateGait({}), { mode: 'distance' });
    const agreeing = result.events.filter((e) => e.agreement === 'both').length;
    expect(agreeing / result.events.length).toBeGreaterThanOrEqual(0.8);
  });

  it('reports frames as decoded-frame indices consistent with the times', () => {
    const clip = generateGait({});
    const { result } = runSynthetic(clip, { mode: 'distance' });
    for (const e of result.events) {
      expect(e.icTimeSec).toBeCloseTo(e.icFrame / clip.clip.declaredFps, 9);
      if (e.toFrame !== null) expect(e.toFrame).toBeGreaterThan(e.icFrame);
    }
  });

  it('keeps frame indices in decoded frames when every second frame is analysed', () => {
    const config = defaultAnalysisConfig();
    config.metrics.frameStep.distance = 2;
    const clip = generateGait({});
    const { result } = runSynthetic(clip, { mode: 'distance', config });
    expect(result.frameStep).toBe(2);
    for (const e of result.events) expect(e.icFrame % 2).toBe(0);
    const cadence = result.metrics.find((m) => m.id === 'cadence');
    expect(Math.abs((cadence?.value ?? 0) - clip.truth.cadenceSpm)).toBeLessThan(3);
  });
});

describe('fitGroundLine', () => {
  it('fits the lower envelope and ignores feet in the air', () => {
    const config = defaultAnalysisConfig();
    const points = [];
    for (let x = 0; x < 1800; x += 20) {
      points.push({ x, y: 900 + 0.05 * x }); // ground, gently sloped
      points.push({ x, y: 820 + 0.05 * x }); // feet in swing
    }
    const fit = fitGroundLine(points, 150, config);
    expect(fit?.b).toBeCloseTo(0.05, 3);
    expect(fit?.a).toBeCloseTo(900, 1);
  });

  it('falls back to a level line when no robust line exists', () => {
    const config = defaultAnalysisConfig();
    const fit = fitGroundLine(
      [
        { x: 10, y: 500 },
        { x: 12, y: 510 },
      ],
      150,
      config,
    );
    expect(fit?.b).toBe(0);
  });
});

describe('findExtrema', () => {
  it('finds one peak per cycle with the minimum separation and prominence', () => {
    const n = 960;
    const times = new Float64Array(n);
    const series = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      times[i] = i / 240;
      series[i] = 40 * Math.sin(2 * Math.PI * 1.5 * (times[i] ?? 0));
    }
    const peaks = findExtrema(series, times, 0.15, 5, 'max');
    expect(peaks).toHaveLength(6);
    const troughs = findExtrema(series, times, 0.15, 5, 'min');
    expect(troughs).toHaveLength(6);
  });
});
