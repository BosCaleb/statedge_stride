import type { StanceEvent } from '@stride/shared/analysisResult';
import type { MetricId, Side } from '@stride/shared/enums';
import { describe, expect, it } from 'vitest';
import { defaultAnalysisConfig } from './config';
import {
  eventQuality,
  labelMetric,
  landmarkQuality,
  lowerOf,
  type ConfidenceContext,
} from './confidence';
import type { MetricComputation } from './metrics';
import { LANDMARK_COUNT, type Track } from './types';

function track(frames: number, missing: { landmark: number; k: number }[] = []): Track {
  const x = Array.from({ length: LANDMARK_COUNT }, () => new Float64Array(frames).fill(100));
  const y = Array.from({ length: LANDMARK_COUNT }, () => new Float64Array(frames).fill(100));
  const v = Array.from({ length: LANDMARK_COUNT }, () => new Float64Array(frames).fill(0.9));
  for (const m of missing) {
    (x[m.landmark] as Float64Array)[m.k] = NaN;
    (y[m.landmark] as Float64Array)[m.k] = NaN;
  }
  return {
    frameCount: frames,
    times: new Float64Array(frames),
    x,
    y,
    v,
    widthPx: 1920,
    heightPx: 1080,
  };
}

function event(agreement: StanceEvent['agreement'], side: Side = 'right'): StanceEvent {
  return { side, icFrame: 0, toFrame: 10, icTimeSec: 0, toTimeSec: 0.1, agreement };
}

function computation(id: MetricId, overrides: Partial<MetricComputation> = {}): MetricComputation {
  return {
    id,
    unit: 'u',
    value: 10,
    n: 6,
    checks: Array.from({ length: 10 }, (_, k) => ({ k, landmarks: [23, 24] })),
    events: Array.from({ length: 6 }, () => event('both')),
    needsEvents: true,
    perSide: false,
    sidesUsed: ['left', 'right'],
    ...overrides,
  };
}

const ctx = (overrides: Partial<ConfidenceContext> = {}): ConfidenceContext => ({
  track: track(20),
  config: defaultAnalysisConfig(),
  effectiveFps: 240,
  nearSide: 'right',
  sideLabelsUncertain: false,
  ...overrides,
});

describe('quality measures', () => {
  it('Ql is the share of checked frames with every needed landmark present', () => {
    const t = track(10, [
      { landmark: 23, k: 2 },
      { landmark: 24, k: 5 },
    ]);
    const checks = Array.from({ length: 10 }, (_, k) => ({ k, landmarks: [23, 24] }));
    expect(landmarkQuality(t, checks)).toBeCloseTo(0.8, 9);
    expect(landmarkQuality(t, [])).toBe(0);
  });

  it('Qe is the share of events where both methods agree', () => {
    expect(
      eventQuality([event('both'), event('primary-only'), event('both'), event('secondary-only')]),
    ).toBe(0.5);
    expect(eventQuality([])).toBe(0);
  });

  it('lowerOf picks the lower label', () => {
    expect(lowerOf('high', 'low')).toBe('low');
    expect(lowerOf('unavailable', 'medium')).toBe('unavailable');
  });
});

describe('labelMetric rules', () => {
  it('labels clean whole-body data high with no reasons', () => {
    const { metric } = labelMetric(computation('cadence'), ctx());
    expect(metric.confidence).toBe('high');
    expect(metric.reasons).toEqual([]);
  });

  it('drops to medium with too few steps, and says so', () => {
    const { metric } = labelMetric(computation('cadence', { n: 3 }), ctx());
    expect(metric.confidence).toBe('medium');
    expect(metric.reasons).toContain('few_cycles');
  });

  it('drops to low when the methods disagree and landmarks are unclear', () => {
    const events = [
      event('both'),
      event('primary-only'),
      event('primary-only'),
      event('primary-only'),
    ];
    const t = track(
      20,
      Array.from({ length: 3 }, (_, k) => ({ landmark: 23, k })),
    );
    const { metric } = labelMetric(computation('cadence', { events }), ctx({ track: t }));
    expect(metric.confidence).toBe('low');
    expect(metric.reasons).toEqual(
      expect.arrayContaining(['events_disagree', 'landmarks_unclear']),
    );
  });

  it('is unavailable, with no value, below the low thresholds', () => {
    const t = track(
      20,
      Array.from({ length: 6 }, (_, k) => ({ landmark: 23, k })),
    );
    const { metric } = labelMetric(computation('cadence'), ctx({ track: t }));
    expect(metric.confidence).toBe('unavailable');
    expect(metric.value).toBeNull();
  });

  it('is unavailable with the reason when a required input is missing', () => {
    const { metric } = labelMetric(
      computation('step_length', { value: null, missing: 'needs_calibration' }),
      ctx(),
    );
    expect(metric.confidence).toBe('unavailable');
    expect(metric.reasons).toEqual(['needs_calibration']);
  });
});

describe('ceilings', () => {
  it('contact time can be high only at 200 fps or more with agreeing events', () => {
    const perSide = {
      perSide: true,
      sidesUsed: ['right'] as Side[],
      nBySide: { left: 0, right: 6 },
    };
    expect(labelMetric(computation('contact_time', perSide), ctx()).metric.confidence).toBe('high');
    const slow = labelMetric(
      computation('contact_time', perSide),
      ctx({ effectiveFps: 180 }),
    ).metric;
    expect(slow.confidence).toBe('medium');
    expect(slow.reasons).toContain('timing_sensitive');
  });

  it('planar-scale metrics are at most medium', () => {
    const { metric } = labelMetric(computation('speed'), ctx());
    expect(metric.confidence).toBe('medium');
    expect(metric.reasons).toEqual(['planar_scale']);
  });

  it('arm swing is at most low', () => {
    const { metric } = labelMetric(
      computation('arm_swing_range', {
        perSide: true,
        sidesUsed: ['right'],
        nBySide: { left: 0, right: 6 },
      }),
      ctx(),
    );
    expect(metric.confidence).toBe('low');
    expect(metric.reasons).toContain('least_reliable_landmarks');
  });

  it('far-side data caps a per-side metric at medium', () => {
    const both = {
      perSide: true,
      sidesUsed: ['left', 'right'] as Side[],
      nBySide: { left: 3, right: 3 },
    };
    const { metric } = labelMetric(computation('overstride', both), ctx());
    expect(metric.confidence).toBe('medium');
    expect(metric.reasons).toEqual(['far_side']);
  });

  it('uncertain side labels cap per-side metrics at low but not whole-body ones', () => {
    const near = { perSide: true, sidesUsed: ['right'] as Side[], nBySide: { left: 0, right: 6 } };
    expect(
      labelMetric(computation('overstride', near), ctx({ sideLabelsUncertain: true })).metric
        .confidence,
    ).toBe('low');
    expect(
      labelMetric(computation('cadence'), ctx({ sideLabelsUncertain: true })).metric.confidence,
    ).toBe('high');
  });
});
