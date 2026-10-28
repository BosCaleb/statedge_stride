import type { GateCheck, MetricResult } from '@stride/shared/analysisResult';
import type { CheckLevel, GateCheckId } from '@stride/shared/enums';
import { GATE_CHECK_IDS } from '@stride/shared/enums';
import { describe, expect, it } from 'vitest';
import { defaultAnalysisConfig } from './config';
import {
  applyGate,
  clipChecks,
  resultChecks,
  type ClipCheckInput,
  type ResultCheckInput,
} from './gate';

const g = defaultAnalysisConfig().gate;

const goodClip: ClipCheckInput = {
  decodable: true,
  effectiveFps: 240,
  mode: 'sprint',
  irregularShare: 0,
  widthPx: 1920,
  heightPx: 1080,
  durationSec: 5,
  calibrationPresent: true,
  athleteSelected: true,
  cameraShiftPx: 1,
};

const goodResult: ResultCheckInput = {
  trackedShare: 1,
  bodyVisibleShare: 1,
  athleteHeightPx: 400,
  feetVisibility: 0.9,
  steadyForwardShare: 1,
  initialContacts: 8,
  alternationBreakShare: 0,
  agreementShare: 1,
  cadenceSpm: 180,
  sideLabelsMatch: true,
};

function levelOf(checks: GateCheck[], id: GateCheckId): CheckLevel | undefined {
  return checks.find((c) => c.id === id)?.level;
}

type Case<T> = [string, Partial<T>, CheckLevel];

// Each check in the gate table has a test for pass, warn and fail (where the table defines them).
const clipCases: Record<string, Case<ClipCheckInput>[]> = {
  codec_decodable: [
    ['decodes', {}, 'pass'],
    ['cannot decode', { decodable: false }, 'fail'],
  ],
  fps_ok: [
    ['240 fps', {}, 'pass'],
    ['150 fps in sprint mode', { effectiveFps: 150 }, 'warn'],
    ['150 fps in distance mode', { effectiveFps: 150, mode: 'distance' }, 'pass'],
    ['99 fps', { effectiveFps: 99 }, 'fail'],
    ['unknown rate', { effectiveFps: null }, 'fail'],
  ],
  timing_regular: [
    ['regular', { irregularShare: 0.01 }, 'pass'],
    ['3 percent irregular', { irregularShare: 0.03 }, 'warn'],
    ['11 percent irregular', { irregularShare: 0.11 }, 'fail'],
  ],
  resolution_ok: [
    ['1080p', {}, 'pass'],
    ['900 px high', { heightPx: 900, widthPx: 1600 }, 'warn'],
    ['portrait 1080p', { widthPx: 1080, heightPx: 1920 }, 'pass'],
    ['700 px high', { heightPx: 700, widthPx: 1244 }, 'fail'],
  ],
  duration_ok: [
    ['5 s', {}, 'pass'],
    ['16 s', { durationSec: 16 }, 'warn'],
    ['0.5 s', { durationSec: 0.5 }, 'fail'],
    ['31 s', { durationSec: 31 }, 'fail'],
  ],
  calibration_present: [
    ['present', {}, 'pass'],
    ['missing', { calibrationPresent: false }, 'warn'],
  ],
  athlete_selected: [
    ['box drawn', {}, 'pass'],
    ['no box', { athleteSelected: false }, 'fail'],
  ],
  camera_stable: [
    ['1 px', {}, 'pass'],
    ['not measured', { cameraShiftPx: null }, 'pass'],
    ['7 px', { cameraShiftPx: 7 }, 'warn'],
    ['16 px', { cameraShiftPx: 16 }, 'fail'],
  ],
};

const resultCases: Record<string, Case<ResultCheckInput>[]> = {
  person_tracked: [
    ['all frames', {}, 'pass'],
    ['85 percent', { trackedShare: 0.85 }, 'warn'],
    ['50 percent', { trackedShare: 0.5 }, 'fail'],
  ],
  body_visible: [
    ['all frames', {}, 'pass'],
    ['80 percent', { bodyVisibleShare: 0.8 }, 'warn'],
    ['40 percent', { bodyVisibleShare: 0.4 }, 'fail'],
  ],
  athlete_size: [
    ['400 px', {}, 'pass'],
    ['150 px', { athleteHeightPx: 150 }, 'warn'],
    ['100 px', { athleteHeightPx: 100 }, 'fail'],
  ],
  feet_visible: [
    ['0.9', {}, 'pass'],
    ['0.5', { feetVisibility: 0.5 }, 'warn'],
    ['0.3', { feetVisibility: 0.3 }, 'fail'],
  ],
  steady_direction: [
    ['always forward', {}, 'pass'],
    ['80 percent', { steadyForwardShare: 0.8 }, 'warn'],
    ['athlete stopped', { steadyForwardShare: 0.5 }, 'fail'],
  ],
  events_found: [
    ['8 contacts', {}, 'pass'],
    ['3 contacts', { initialContacts: 3 }, 'warn'],
    ['1 contact', { initialContacts: 1 }, 'fail'],
  ],
  events_alternate: [
    ['alternating', {}, 'pass'],
    ['20 percent broken', { alternationBreakShare: 0.2 }, 'warn'],
    ['40 percent broken', { alternationBreakShare: 0.4 }, 'fail'],
  ],
  method_agreement: [
    ['all agree', {}, 'pass'],
    ['half agree', { agreementShare: 0.5 }, 'warn'],
  ],
  timebase_plausible: [
    ['180 spm', {}, 'pass'],
    ['not measured', { cadenceSpm: null }, 'pass'],
    ['Super slow-mo (45 spm)', { cadenceSpm: 45 }, 'fail'],
    ['re-timed file (720 spm)', { cadenceSpm: 720 }, 'fail'],
  ],
  side_labels: [
    ['match', {}, 'pass'],
    ['mismatch', { sideLabelsMatch: false }, 'warn'],
  ],
};

describe('clip-level checks', () => {
  for (const [id, cases] of Object.entries(clipCases)) {
    it.each(cases)(`${id}: %s gives %s`, (_label, override, expected) => {
      void _label;
      expect(levelOf(clipChecks({ ...goodClip, ...override }, g), id as GateCheckId)).toBe(
        expected,
      );
    });
  }
});

describe('result-level checks', () => {
  for (const [id, cases] of Object.entries(resultCases)) {
    it.each(cases)(`${id}: %s gives %s`, (_label, override, expected) => {
      void _label;
      expect(levelOf(resultChecks({ ...goodResult, ...override }, g), id as GateCheckId)).toBe(
        expected,
      );
    });
  }

  it('covers every check id in the gate table', () => {
    const covered = new Set([...Object.keys(clipCases), ...Object.keys(resultCases)]);
    expect([...covered].sort()).toEqual([...GATE_CHECK_IDS].sort());
    const all = [...clipChecks(goodClip, g), ...resultChecks(goodResult, g)];
    expect(all.map((c) => c.id).sort()).toEqual([...GATE_CHECK_IDS].sort());
    expect(all.every((c) => c.ok && c.level === 'pass')).toBe(true);
  });
});

function metric(
  id: MetricResult['id'],
  confidence: MetricResult['confidence'] = 'high',
): MetricResult {
  return { id, value: 1, unit: 'u', n: 6, confidence, reasons: [] };
}

describe('applyGate', () => {
  const metrics = [
    metric('cadence'),
    metric('contact_time'),
    metric('flight_time'),
    metric('step_length', 'medium'),
    metric('stride_length', 'medium'),
    metric('speed', 'medium'),
    { ...metric('vertical_oscillation', 'medium'), secondary: { value: 8, unit: 'cm' } },
    metric('trunk_lean'),
  ];

  it('passes with no warnings and leaves the metrics alone', () => {
    const { gate, metrics: out } = applyGate(
      [...clipChecks(goodClip, g), ...resultChecks(goodResult, g)],
      metrics,
    );
    expect(gate.status).toBe('pass');
    expect(gate.hiddenMetrics).toEqual([]);
    expect(out).toEqual(metrics);
  });

  it('hides exactly the scaled metrics when calibration is missing (conditional)', () => {
    const checks = [
      ...clipChecks({ ...goodClip, calibrationPresent: false }, g),
      ...resultChecks(goodResult, g),
    ];
    const { gate, metrics: out } = applyGate(checks, metrics);
    expect(gate.status).toBe('conditional');
    expect(gate.hiddenMetrics.sort()).toEqual(['speed', 'step_length', 'stride_length']);
    for (const id of ['step_length', 'stride_length', 'speed'] as const) {
      const m = out.find((x) => x.id === id);
      expect(m?.value).toBeNull();
      expect(m?.confidence).toBe('unavailable');
      expect(m?.reasons).toEqual(['gate:calibration_present']);
    }
    const vo = out.find((x) => x.id === 'vertical_oscillation');
    expect(vo?.value).toBe(1);
    expect(vo?.secondary?.value).toBeNull();
    expect(out.find((x) => x.id === 'cadence')?.value).toBe(1);
  });

  it('caps contact and flight time at medium below 200 fps in sprint mode', () => {
    const checks = [
      ...clipChecks({ ...goodClip, effectiveFps: 150 }, g),
      ...resultChecks(goodResult, g),
    ];
    const { gate, metrics: out } = applyGate(checks, metrics);
    expect(gate.status).toBe('conditional');
    expect(out.find((x) => x.id === 'contact_time')?.confidence).toBe('medium');
    expect(out.find((x) => x.id === 'contact_time')?.reasons).toContain('gate:fps_ok');
    expect(out.find((x) => x.id === 'flight_time')?.confidence).toBe('medium');
    expect(out.find((x) => x.id === 'cadence')?.confidence).toBe('high');
  });

  it('fails when any check fails, hiding every metric', () => {
    const checks = [
      ...clipChecks(goodClip, g),
      ...resultChecks({ ...goodResult, cadenceSpm: 40 }, g),
    ];
    const { gate, metrics: out } = applyGate(checks, metrics);
    expect(gate.status).toBe('fail');
    expect(gate.hiddenMetrics).toHaveLength(metrics.length);
    expect(out.every((m) => m.value === null && m.confidence === 'unavailable')).toBe(true);
    expect(out.find((x) => x.id === 'vertical_oscillation')?.secondary?.value).toBeNull();
  });
});
