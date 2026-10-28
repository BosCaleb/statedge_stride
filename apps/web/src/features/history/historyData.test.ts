import { runSynthetic } from '@stride/analysis/testing/runSynthetic';
import { generateGait } from '@stride/analysis/testing/syntheticGait';
import type { HistoryEntry } from '@stride/shared/api/analyses';
import { describe, expect, it } from 'vitest';
import type { LocalResult } from '../../lib/local/records';
import { trendPoints } from './HistorySection';
import { mergeHistory, rowFromLocal, rowFromServer, type HistoryRow } from './historyData';

const result = runSynthetic(generateGait({ noisePx: 1 }), { mode: 'distance' }).result;

const local = (id: string, createdAt: string): LocalResult => ({
  id,
  clipId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  athleteId: '00000000-0000-4000-8000-000000000003',
  calibrationId: null,
  roi: { x: 0, y: 0, width: 100, height: 200 },
  roiFrame: 0,
  result,
  keypoints: new Blob([]),
  stats: {
    decoder: 'video-element',
    delegate: 'CPU',
    framesAnalysed: 1,
    framesWithPose: 1,
    poseMsMedian: 1,
    poseMsTotal: 1,
    wallMs: 1,
    droppedFrames: 0,
    stoppedAt: null,
  },
  noteDraft: '',
  createdAt,
  savedAt: null,
});

const row = (id: string, sessionDate: string, createdAt: string, extra: Partial<HistoryRow> = {}) =>
  ({
    id,
    sessionId: 's',
    sessionDate,
    createdAt,
    mode: 'distance',
    gateStatus: 'pass',
    saved: true,
    metrics: [{ metricId: 'cadence', value: 170, unit: 'spm', confidence: 'high' }],
    ...extra,
  }) satisfies HistoryRow;

describe('history rows', () => {
  it('reads a phone result with only its measured metrics', () => {
    const r = rowFromLocal(local('l1', '2026-10-20T09:00:00.000Z'), '2026-10-19');
    expect(r).toMatchObject({
      id: 'l1',
      sessionDate: '2026-10-19',
      saved: false,
      mode: 'distance',
    });
    expect(r.metrics.every((m) => m.value !== null && m.confidence !== 'unavailable')).toBe(true);
    // Without the session (not on this phone), the day it was made stands in.
    expect(rowFromLocal(local('l2', '2026-10-20T09:00:00.000Z'), undefined).sessionDate).toBe(
      '2026-10-20',
    );
  });

  it('reads a saved analysis from the API', () => {
    const entry: HistoryEntry = {
      id: 'a1',
      clipId: 'c1',
      athleteId: 'p1',
      sessionId: 's1',
      mode: 'sprint',
      algorithmVersion: '1',
      poseModel: 'm@1',
      gateStatus: 'conditional',
      hasKeypoints: true,
      createdBy: 'k1',
      createdAt: '2026-10-01T08:00:00.000Z',
      supersededBy: null,
      sessionDate: '2026-10-01',
      metrics: [
        {
          metricId: 'speed',
          value: 7.1,
          left: null,
          right: null,
          sd: 0.1,
          n: 4,
          unit: 'm/s',
          confidence: 'medium',
        },
      ],
    };
    expect(rowFromServer(entry)).toEqual({
      id: 'a1',
      sessionId: 's1',
      sessionDate: '2026-10-01',
      createdAt: '2026-10-01T08:00:00.000Z',
      mode: 'sprint',
      gateStatus: 'conditional',
      saved: true,
      metrics: [{ metricId: 'speed', value: 7.1, unit: 'm/s', confidence: 'medium' }],
    });
  });

  it('merges saved and unsaved rows newest first, each analysis once', () => {
    const server = [
      row('b', '2026-10-10', '2026-10-10T10:00:00Z'),
      row('a', '2026-09-01', '2026-09-01T10:00:00Z'),
    ];
    const phone = [
      row('c', '2026-10-10', '2026-10-10T11:00:00Z', { saved: false }),
      // Saved since, and the API already lists it.
      row('b', '2026-10-10', '2026-10-10T10:00:00Z', { saved: false }),
    ];
    const merged = mergeHistory(server, phone);
    expect(merged.map((r) => [r.id, r.saved])).toEqual([
      ['c', false],
      ['b', true],
      ['a', true],
    ]);
  });
});

describe('trendPoints', () => {
  it('keeps one mode and one metric, oldest first, with the confidence of each', () => {
    const rows = [
      row('c', '2026-10-20', '2026-10-20T10:00:00Z', {
        metrics: [{ metricId: 'cadence', value: 174.4, unit: 'spm', confidence: 'low' }],
      }),
      row('s', '2026-10-15', '2026-10-15T10:00:00Z', { mode: 'sprint' }),
      row('b', '2026-10-10', '2026-10-10T10:00:00Z', { metrics: [] }),
      row('a', '2026-10-01', '2026-10-01T10:00:00Z'),
    ];
    expect(trendPoints(rows, 'cadence', 'distance')).toEqual([
      { date: '2026-10-01', value: 170, label: '170 steps/min', confidence: 'high' },
      { date: '2026-10-20', value: 174.4, label: '174 steps/min', confidence: 'low' },
    ]);
    expect(trendPoints(rows, 'cadence', 'sprint')).toHaveLength(1);
  });
});
