import { runSynthetic } from '@stride/analysis/testing/runSynthetic';
import { generateGait } from '@stride/analysis/testing/syntheticGait';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import type { MetricId } from '@stride/shared/enums';
import { describe, expect, it } from 'vitest';
import { comparisonCaveats, metricChanges } from './compareLogic';

const base = runSynthetic(generateGait({ noisePx: 1 }), { mode: 'distance' }).result;

function shifted(r: AnalysisResult, id: MetricId, delta: number): AnalysisResult {
  return {
    ...r,
    metrics: r.metrics.map((m) =>
      m.id === id && m.value !== null ? { ...m, value: m.value + delta } : m,
    ),
  };
}

const changeOf = (before: AnalysisResult, after: AnalysisResult, id: MetricId) =>
  metricChanges(before, after).find((c) => c.id === id);

describe('comparisonCaveats', () => {
  it('has nothing to say about two like analyses', () => {
    expect(comparisonCaveats(base, base)).toEqual([]);
  });

  it('warns about the mode, the calibration, the version and the frame rate', () => {
    const other: AnalysisResult = {
      ...base,
      mode: 'sprint',
      calibration: null,
      algorithmVersion: `${base.algorithmVersion}-other`,
      captureFps: base.captureFps / 2,
    };
    expect(comparisonCaveats(base, other)).toEqual([
      'mode_differs',
      'calibration_differs',
      'algorithm_differs',
      'frame_rate_differs',
    ]);
  });

  it('takes a scale within 2 per cent, and a rate within 10 per cent, as the same', () => {
    const cal = base.calibration;
    if (!cal) throw new Error('the synthetic run is calibrated');
    const near: AnalysisResult = {
      ...base,
      calibration: { ...cal, pxPerM: cal.pxPerM * 1.015 },
      captureFps: base.captureFps * 0.95,
    };
    expect(comparisonCaveats(base, near)).toEqual([]);
    const far: AnalysisResult = {
      ...base,
      calibration: { ...cal, pxPerM: cal.pxPerM * 1.03 },
      captureFps: base.captureFps * 0.85,
    };
    expect(comparisonCaveats(base, far)).toEqual(['calibration_differs', 'frame_rate_differs']);
    expect(comparisonCaveats(base, { ...base, calibration: { ...cal, distanceM: 10 } })).toEqual([
      'calibration_differs',
    ]);
  });
});

describe('metricChanges', () => {
  it('lists the later mode’s measurements with the change in neutral words', () => {
    const later = shifted(base, 'cadence', 4);
    const changes = metricChanges(base, later);
    const lists = base.configSnapshot.metrics.byMode.distance;
    expect(changes.map((c) => c.id)).toEqual([...lists.primary, ...lists.secondary]);
    expect(changeOf(base, later, 'cadence')).toMatchObject({ direction: 'higher', unit: 'spm' });
    expect(changeOf(base, later, 'cadence')?.change).toBeCloseTo(4, 6);
    expect(changeOf(later, base, 'cadence')?.direction).toBe('lower');
  });

  it('calls a change that rounds to nothing no change', () => {
    // Cadence shows whole steps per minute.
    expect(changeOf(base, shifted(base, 'cadence', 0.4), 'cadence')?.direction).toBe('same');
    expect(changeOf(base, shifted(base, 'cadence', -0.4), 'cadence')?.direction).toBe('same');
  });

  it('has no change when either analysis did not measure it', () => {
    const unmeasured: AnalysisResult = {
      ...base,
      metrics: base.metrics.map((m) =>
        m.id === 'cadence' ? { ...m, value: null, confidence: 'unavailable' } : m,
      ),
    };
    expect(changeOf(base, unmeasured, 'cadence')).toMatchObject({
      after: null,
      change: null,
      direction: null,
    });
    expect(changeOf(unmeasured, base, 'cadence')?.before).toBeNull();
  });
});
