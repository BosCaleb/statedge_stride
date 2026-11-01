import type { StanceEvent } from '@stride/shared/analysisResult';
import { describe, expect, it } from 'vitest';
import { defaultAnalysisConfig } from './config';
import { dropDuplicateContacts, findExtrema, fitGroundLine } from './events';
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

describe('dropDuplicateContacts', () => {
  const at = (
    side: 'left' | 'right',
    frame: number,
    agreement: StanceEvent['agreement'] = 'both',
  ): StanceEvent => ({
    side,
    icFrame: frame,
    toFrame: frame + 25,
    icTimeSec: frame / 240,
    toTimeSec: (frame + 25) / 240,
    agreement,
  });

  it('keeps steps a real runner can take', () => {
    // Sprinting at about 260 steps a minute: a contact every 55 frames at 240 fps.
    const steps = [at('right', 20), at('left', 75), at('right', 130), at('left', 185)];
    expect(dropDuplicateContacts(steps, 0.15, 0.5)).toEqual({ events: steps, dropped: 0 });
  });

  it('counts one landing seen as both feet once, keeping left and right alternating', () => {
    // As in a small, side-on sprinter whose far leg is hidden: the right foot's landing at frame
    // 59 is also seen as the left foot 14 frames later (58 ms).
    const seen = [
      at('left', 4, 'secondary-only'),
      at('right', 59, 'secondary-only'),
      at('left', 73, 'secondary-only'),
      at('left', 114, 'secondary-only'),
    ];
    const { events, dropped } = dropDuplicateContacts(seen, 0.15, 0.5);
    expect(dropped).toBe(1);
    expect(events.map((e) => [e.side, e.icFrame])).toEqual([
      ['left', 4],
      ['right', 59],
      ['left', 114],
    ]);
  });

  it('finds landings seen twice even when they are half of the gaps', () => {
    // The pattern of the clip that prompted this: two landings each seen as both feet.
    const seen = [
      at('right', 59, 'secondary-only'),
      at('left', 73, 'secondary-only'),
      at('right', 112, 'secondary-only'),
      at('left', 124, 'secondary-only'),
      at('left', 241, 'primary-only'),
    ];
    const { events, dropped } = dropDuplicateContacts(seen, 0.15, 0.5);
    expect(dropped).toBe(2);
    expect(events.map((e) => [e.side, e.icFrame])).toEqual([
      ['right', 59],
      ['left', 124],
      ['left', 241],
    ]);
  });

  it('keeps every contact when all of them are too close (a wrong frame rate)', () => {
    // A 240 fps clip read as 960 fps: steps 55 frames apart look 14 frames apart.
    const fast = [at('right', 0), at('left', 14), at('right', 28), at('left', 42), at('right', 56)];
    expect(dropDuplicateContacts(fast, 0.15, 0.5)).toEqual({ events: fast, dropped: 0 });
  });

  it('prefers the contact both methods agree on', () => {
    const { events } = dropDuplicateContacts(
      [at('left', 10), at('right', 60, 'secondary-only'), at('right', 70, 'both'), at('left', 125)],
      0.15,
      0.5,
    );
    expect(events.map((e) => [e.side, e.icFrame, e.agreement])).toEqual([
      ['left', 10, 'both'],
      ['right', 70, 'both'],
      ['left', 125, 'both'],
    ]);
  });

  it('keeps the earlier contact when nothing tells them apart', () => {
    const { events } = dropDuplicateContacts(
      [at('right', 60), at('left', 70), at('right', 125), at('left', 180)],
      0.15,
      0.5,
    );
    expect(events.map((e) => e.icFrame)).toEqual([60, 125, 180]);
  });
});
