import { runSynthetic } from '@stride/analysis/testing/runSynthetic';
import { generateGait } from '@stride/analysis/testing/syntheticGait';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotInput } from './buildSnapshot';

const distance = runSynthetic(generateGait({ noisePx: 1 }), { mode: 'distance' }).result;
const later = runSynthetic(generateGait({ noisePx: 1, seed: 3 }), { mode: 'distance' }).result;
const sprint = runSynthetic(generateGait({ noisePx: 1, seed: 5 }), { mode: 'sprint' }).result;

/** The result with one metric made unmeasurable, as the gate or the data would. */
function withHidden(r: AnalysisResult): AnalysisResult {
  return {
    ...r,
    metrics: r.metrics.map((m, i) =>
      i === 0 ? { ...m, value: null, confidence: 'unavailable', reasons: ['few_cycles'] } : m,
    ),
  };
}

const ids = {
  a: '0b6c1f0e-5d1a-4c8e-9a9c-111111111111',
  b: '0b6c1f0e-5d1a-4c8e-9a9c-222222222222',
};

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    title: 'Running technique report',
    organisationName: 'Test School',
    athlete: { firstName: 'Lerato', lastName: 'Molefe' },
    nameStyle: 'short',
    session: { date: '2026-03-14', mode: 'distance', place: 'Main track', surface: null },
    analyses: [{ id: ids.a, createdAt: '2026-03-14T08:00:00.000Z', result: withHidden(distance) }],
    notes: [{ text: 'Relaxed shoulders.', createdAt: '2026-03-14T09:00:00.000Z' }],
    frames: [
      { label: 'a1:ic', caption: 'Right foot, initial contact' },
      { label: 'a1:mid', caption: 'Right foot, mid-stance' },
      { label: 'a1:to', caption: 'Right foot, toe-off' },
    ],
    now: new Date('2026-03-15T10:00:00.000Z'),
    ...overrides,
  };
}

describe('buildSnapshot', () => {
  it('names the athlete by first name and initial unless the coach chose the full name', () => {
    expect(buildSnapshot(input()).athleteDisplayName).toBe('Lerato M.');
    expect(buildSnapshot(input({ nameStyle: 'full' })).athleteDisplayName).toBe('Lerato Molefe');
    expect(JSON.stringify(buildSnapshot(input()))).not.toContain('Molefe');
  });

  it('holds results only: no keypoints, birth year or configuration', () => {
    const text = JSON.stringify(buildSnapshot(input()));
    expect(text).not.toContain('birthYear');
    expect(text).not.toContain('keypoints');
    expect(text).not.toContain('configSnapshot');
    expect(text).not.toContain('events');
  });

  it('carries the ticked notes and nothing else', () => {
    const snapshot = buildSnapshot(input({ notes: [] }));
    expect(snapshot.notes).toEqual([]);
    const one = buildSnapshot(input());
    expect(one.notes.map((n) => n.text)).toEqual(['Relaxed shoulders.']);
  });

  it('lists a metric that was not measured once, with its reasons, never as a value', () => {
    const snapshot = buildSnapshot(input());
    const [analysis] = snapshot.analyses;
    const hiddenId = withHidden(distance).metrics[0]?.id;
    expect(analysis?.hidden).toContainEqual({ id: hiddenId, reasons: ['few_cycles'] });
    expect(analysis?.metrics.map((m) => m.id)).not.toContain(hiddenId);
    expect(analysis?.metrics.every((m) => m.value !== null && m.confidence !== 'unavailable')).toBe(
      true,
    );
  });

  it('keeps every shown metric with its confidence label, the primary ones first', () => {
    const [analysis] = buildSnapshot(input()).analyses;
    if (!analysis) throw new Error('no analysis');
    expect(analysis.primary.length).toBeGreaterThan(0);
    expect(analysis.metrics.slice(0, analysis.primary.length).map((m) => m.id)).toEqual(
      analysis.primary,
    );
    expect(analysis.metrics.every((m) => ['high', 'medium', 'low'].includes(m.confidence))).toBe(
      true,
    );
  });

  it('numbers the frames in the order chosen', () => {
    expect(buildSnapshot(input()).frames.map((f) => [f.ordinal, f.label])).toEqual([
      [1, 'a1:ic'],
      [2, 'a1:mid'],
      [3, 'a1:to'],
    ]);
  });

  it('compares two analyses of one mode, earlier first, with the caveats', () => {
    const snapshot = buildSnapshot(
      input({
        analyses: [
          { id: ids.a, createdAt: '2026-03-01T08:00:00.000Z', result: distance },
          { id: ids.b, createdAt: '2026-03-14T08:00:00.000Z', result: later },
        ],
      }),
    );
    expect(snapshot.comparison).toMatchObject({
      baselineAnalysisId: ids.a,
      laterAnalysisId: ids.b,
    });
    expect(snapshot.analyses.map((a) => a.id)).toEqual([ids.a, ids.b]);
  });

  it('refuses a comparison across modes, and a failed result', () => {
    expect(() =>
      buildSnapshot(
        input({
          analyses: [
            { id: ids.a, createdAt: '2026-03-01T08:00:00.000Z', result: distance },
            { id: ids.b, createdAt: '2026-03-14T08:00:00.000Z', result: sprint },
          ],
        }),
      ),
    ).toThrow(/same mode/);
    const failed: AnalysisResult = { ...distance, gate: { ...distance.gate, status: 'fail' } };
    expect(() =>
      buildSnapshot(
        input({ analyses: [{ id: ids.a, createdAt: '2026-03-14T08:00:00.000Z', result: failed }] }),
      ),
    ).toThrow(/quality gate/);
  });

  it('leaves out empty session details', () => {
    expect(buildSnapshot(input()).session).toEqual({
      date: '2026-03-14',
      mode: 'distance',
      place: 'Main track',
    });
  });
});
