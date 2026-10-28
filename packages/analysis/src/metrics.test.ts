import type { MetricResult } from '@stride/shared/analysisResult';
import type { Confidence, MetricId } from '@stride/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  generateGait,
  SPRINT_GAIT,
  type GaitOptions,
  type GaitTruth,
} from './testing/syntheticGait';
import { runSynthetic } from './testing/runSynthetic';

// Synthetic gait recovery. Tolerances are stated per metric. Event-based timing carries a known
// bias from smoothing with the starting thresholds (contact time reads about 15 ms short), which
// the spike is expected to tune away; the tolerances below include it, and the bias itself is
// pinned by a test so that a change in behaviour is noticed.

function metric(metrics: readonly MetricResult[], id: MetricId): MetricResult {
  const m = metrics.find((x) => x.id === id);
  if (!m) throw new Error(`missing metric ${id}`);
  return m;
}

function value(metrics: readonly MetricResult[], id: MetricId): number {
  const v = metric(metrics, id).value;
  if (v === null) throw new Error(`metric ${id} has no value`);
  return v;
}

interface Tolerances {
  cadence: number;
  strideFrequency: number;
  contactTimeMs: number;
  flightTimeMs: number;
  stepLength: number;
  strideLength: number;
  speed: number;
  overstride: number;
  kneeFlexion: number;
  trunkLean: number;
  verticalOscillation: number;
  armSwing: number;
}

function expectRecovered(metrics: readonly MetricResult[], truth: GaitTruth, tol: Tolerances) {
  expect(Math.abs(value(metrics, 'cadence') - truth.cadenceSpm)).toBeLessThan(tol.cadence);
  expect(Math.abs(value(metrics, 'stride_frequency') - truth.strideFrequencyHz)).toBeLessThan(
    tol.strideFrequency,
  );
  expect(Math.abs(value(metrics, 'contact_time') - truth.contactTimeMs)).toBeLessThan(
    tol.contactTimeMs,
  );
  expect(Math.abs(value(metrics, 'flight_time') - truth.flightTimeMs)).toBeLessThan(
    tol.flightTimeMs,
  );
  expect(Math.abs(value(metrics, 'step_length') - truth.stepLengthM)).toBeLessThan(tol.stepLength);
  expect(Math.abs(value(metrics, 'stride_length') - truth.strideLengthM)).toBeLessThan(
    tol.strideLength,
  );
  expect(Math.abs(value(metrics, 'speed') - truth.speedMps)).toBeLessThan(tol.speed);
  expect(Math.abs(value(metrics, 'overstride') - truth.overstridePct)).toBeLessThan(tol.overstride);
  expect(Math.abs(value(metrics, 'knee_flexion_ic') - truth.kneeFlexionIcDeg)).toBeLessThan(
    tol.kneeFlexion,
  );
  expect(Math.abs(value(metrics, 'trunk_lean') - truth.trunkLeanDeg)).toBeLessThan(tol.trunkLean);
  expect(
    Math.abs(value(metrics, 'vertical_oscillation') - truth.verticalOscillationPct),
  ).toBeLessThan(tol.verticalOscillation);
  expect(Math.abs(value(metrics, 'arm_swing_range') - truth.armSwingRangeDeg)).toBeLessThan(
    tol.armSwing,
  );
}

const DISTANCE_TOLERANCES: Tolerances = {
  cadence: 1.5,
  strideFrequency: 0.03,
  contactTimeMs: 25,
  flightTimeMs: 25,
  stepLength: 0.03,
  strideLength: 0.05,
  speed: 0.1,
  overstride: 5,
  // Includes a bias of about +4 degrees: the knee is still flexing when IC is detected (late).
  kneeFlexion: 7,
  trunkLean: 0.5,
  verticalOscillation: 1,
  armSwing: 3,
};

describe('synthetic distance running', () => {
  it.each([0, 1, 2, 3])('recovers every metric within tolerance at %i px of noise', (noisePx) => {
    const clip = generateGait({ noisePx, seed: 10 + noisePx });
    const { result } = runSynthetic(clip, { mode: 'distance' });
    expect(result.gate.status).not.toBe('fail');
    expectRecovered(result.metrics, clip.truth, DISTANCE_TOLERANCES);
  });

  it('recovers the same metrics when the athlete runs right to left', () => {
    const ltr = runSynthetic(generateGait({ direction: 1, noisePx: 1 }), {
      mode: 'distance',
    }).result;
    const rtlClip = generateGait({ direction: -1, noisePx: 1 });
    const rtl = runSynthetic(rtlClip, { mode: 'distance' }).result;
    expect(rtl.direction).toBe(-1);
    expect(ltr.direction).toBe(1);
    expectRecovered(rtl.metrics, rtlClip.truth, DISTANCE_TOLERANCES);
    // Labels follow the athlete: in the mirrored run the left leg is near the camera.
    expect(metric(rtl.metrics, 'contact_time').bySide?.left).not.toBeNull();
  });

  it('measures vertical oscillation in centimetres when calibrated', () => {
    const clip = generateGait({});
    const { result } = runSynthetic(clip, { mode: 'distance' });
    const vo = metric(result.metrics, 'vertical_oscillation');
    expect(vo.unit).toBe('%L');
    expect(vo.secondary?.unit).toBe('cm');
    expect(Math.abs((vo.secondary?.value ?? NaN) - clip.truth.verticalOscillationCm)).toBeLessThan(
      0.5,
    );
  });

  it('reports no asymmetry for a symmetric runner', () => {
    const { result } = runSynthetic(generateGait({ noisePx: 1 }), { mode: 'distance' });
    expect(value(result.metrics, 'contact_asymmetry')).toBeLessThan(3);
    expect(value(result.metrics, 'step_time_asymmetry')).toBeLessThan(3);
  });

  it('returns spread when at least three cycles were used', () => {
    const { result } = runSynthetic(generateGait({ noisePx: 1 }), { mode: 'distance' });
    const cadence = metric(result.metrics, 'cadence');
    expect(cadence.n).toBeGreaterThanOrEqual(3);
    expect(cadence.sd).toBeGreaterThanOrEqual(0);
    expect(cadence.sd).toBeLessThan(5);
  });

  it('pins the known smoothing bias of contact time with the starting thresholds', () => {
    const clip = generateGait({});
    const { result } = runSynthetic(clip, { mode: 'distance' });
    const bias = value(result.metrics, 'contact_time') - clip.truth.contactTimeMs;
    // About -14 ms at 240 fps. If this changes, update docs/spike-report.md.
    expect(bias).toBeLessThan(-5);
    expect(bias).toBeGreaterThan(-25);
  });
});

describe('synthetic sprinting', () => {
  const SPRINT_TOLERANCES: Tolerances = {
    ...DISTANCE_TOLERANCES,
    cadence: 2.5,
    strideFrequency: 0.05,
    contactTimeMs: 25,
    flightTimeMs: 25,
    strideLength: 0.08,
    overstride: 7,
  };

  it.each([0, 1, 2])('recovers every metric within tolerance at %i px of noise', (noisePx) => {
    const clip = generateGait({ ...SPRINT_GAIT, noisePx, seed: 20 + noisePx });
    const { result } = runSynthetic(clip, { mode: 'sprint' });
    expect(result.gate.status).not.toBe('fail');
    expectRecovered(result.metrics, clip.truth, SPRINT_TOLERANCES);
  });
});

const RANK: Record<Confidence, number> = { unavailable: 0, low: 1, medium: 2, high: 3 };

function confidenceScore(options: Partial<GaitOptions>): number {
  const { result } = runSynthetic(generateGait(options), { mode: 'distance' });
  return result.metrics.reduce((sum, m) => sum + RANK[m.confidence], 0);
}

describe('confidence falls as the data gets worse', () => {
  it('as landmark noise increases', () => {
    const scores = [0, 3, 6].map((noisePx) => confidenceScore({ noisePx, seed: 3 }));
    expect(scores[1]).toBeLessThanOrEqual(scores[0] ?? 0);
    expect(scores[2]).toBeLessThan(scores[0] ?? 0);
  });

  it('as dropped landmarks increase', () => {
    const scores = [0, 0.04, 0.12, 0.3].map((dropoutRate) =>
      confidenceScore({ noisePx: 1, dropoutRate, seed: 4 }),
    );
    for (let i = 1; i < scores.length; i++)
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] ?? 0);
    expect(scores[3]).toBeLessThan(scores[0] ?? 0);
  });

  it('gives every lowered label at least one reason', () => {
    const { result } = runSynthetic(generateGait({ noisePx: 2, dropoutRate: 0.08, seed: 9 }), {
      mode: 'distance',
    });
    for (const m of result.metrics) {
      if (m.confidence !== 'high') expect(m.reasons.length).toBeGreaterThan(0);
      else expect(m.reasons).toEqual([]);
    }
  });
});
