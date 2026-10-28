import { analysisPutSchema } from '@stride/shared/api/analyses';
import { reportSnapshotSchema, type ReportSnapshot } from '@stride/shared/reportSnapshot';
import { describe, expect, it } from 'vitest';
import { generateGait } from './testing/syntheticGait';
import { runSynthetic } from './testing/runSynthetic';

// The API contract checked against real engine output: what the phone saves must parse on the
// server, and the server's plausibility rules must catch a tampered value.

const { result } = runSynthetic(generateGait({ noisePx: 1 }), { mode: 'distance' });
const body = {
  clipId: '0b9c2a4e-6f0d-4c39-9d64-8f6f1f0e2a11',
  athleteId: '6a1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22',
  result,
};

describe('PUT /v1/analyses/{id} body', () => {
  it('accepts a result produced by the engine, unchanged by a JSON round trip', () => {
    const parsed = analysisPutSchema.parse(JSON.parse(JSON.stringify(body)));
    expect(parsed.result).toEqual(result);
  });

  it('rejects an implausible value with the path of the value', () => {
    const tampered = structuredClone(body);
    const i = tampered.result.metrics.findIndex((m) => m.id === 'cadence');
    const metric = tampered.result.metrics[i];
    if (!metric) throw new Error('no cadence');
    metric.value = 2000;
    const parsed = analysisPutSchema.safeParse(tampered);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((x) => x.path)).toContainEqual([
      'result',
      'metrics',
      i,
      'value',
    ]);
  });

  it('rejects a duplicated metric, an unknown metric id and an unsupported schema version', () => {
    const duplicated = structuredClone(body);
    const first = duplicated.result.metrics[0];
    if (!first) throw new Error('no metrics');
    duplicated.result.metrics.push(first);
    expect(analysisPutSchema.safeParse(duplicated).success).toBe(false);

    const unknown = JSON.parse(JSON.stringify(body)) as { result: { metrics: { id: string }[] } };
    const m = unknown.result.metrics[0];
    if (m) m.id = 'ground_reaction_force';
    expect(analysisPutSchema.safeParse(unknown).success).toBe(false);

    const version = { ...body, result: { ...body.result, schemaVersion: 2 } };
    expect(analysisPutSchema.safeParse(version).success).toBe(false);
  });
});

describe('report snapshot', () => {
  const analysis = {
    id: '1c3b5d7f-9a2b-4c6d-8e0f-1a2b3c4d5e6f',
    createdAt: result.createdAt,
    algorithmVersion: result.algorithmVersion,
    gateStatus: 'pass' as const,
    metrics: result.metrics.filter((x) => x.value !== null),
    hidden: result.metrics
      .filter((x) => x.value === null)
      .map((x) => ({ id: x.id, reasons: x.reasons })),
  };
  const snapshot: ReportSnapshot = {
    schemaVersion: 1,
    title: 'Distance technique, March',
    organisationName: 'Test School',
    athleteDisplayName: 'Ayanda M.',
    session: { date: '2026-03-14', mode: 'distance', surface: 'track' },
    analyses: [analysis],
    notes: [{ text: 'Relaxed shoulders today.', createdAt: result.createdAt }],
    frames: [
      { ordinal: 1, label: 'right:ic', caption: 'Right foot, initial contact' },
      { ordinal: 2, label: 'right:mid', caption: 'Right foot, mid-stance' },
    ],
    generatedAt: result.createdAt,
  };

  it('round-trips a snapshot built from a real result', () => {
    expect(reportSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it('drops fields the snapshot does not define, such as a birth year', () => {
    const withExtra = { ...snapshot, birthYear: 2010, athlete: { lastName: 'Mokoena' } };
    const parsed = reportSnapshotSchema.parse(withExtra);
    expect(JSON.stringify(parsed)).not.toContain('2010');
    expect(JSON.stringify(parsed)).not.toContain('Mokoena');
  });

  it('needs a comparison for two analyses, and unique frame ordinals', () => {
    const second = { ...analysis, id: '2c3b5d7f-9a2b-4c6d-8e0f-1a2b3c4d5e6f' };
    expect(
      reportSnapshotSchema.safeParse({ ...snapshot, analyses: [analysis, second] }).success,
    ).toBe(false);
    const comparison = {
      baselineAnalysisId: analysis.id,
      laterAnalysisId: second.id,
      caveats: ['calibration_differs' as const],
    };
    expect(
      reportSnapshotSchema.safeParse({ ...snapshot, analyses: [analysis, second], comparison })
        .success,
    ).toBe(true);
    const frames = [snapshot.frames[0], snapshot.frames[0]];
    expect(reportSnapshotSchema.safeParse({ ...snapshot, frames }).success).toBe(false);
  });
});
