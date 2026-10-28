import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { defaultAnalysisConfig } from '@stride/analysis/config';
import { clipChecks } from '@stride/analysis/gate';
import { analyse } from '@stride/analysis/pipeline';
import { decodeSkp1 } from '@stride/analysis/skp1';
import { chooseTimebase, timingStats } from '@stride/analysis/timebase';
import type { PoseFrame } from '@stride/analysis/types';
import { describe, expect, it } from 'vitest';
import { fixtureManifestSchema, type FixtureSpec } from './manifestSchema';

// Fixture tests: every keypoint fixture runs through the pure pipeline and must produce its
// expected gate result and metric ranges. Synthetic fixtures today; recorded spike fixtures are
// added to the same manifest.

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const manifest = fixtureManifestSchema.parse(
  JSON.parse(readFileSync(here('./manifest.json'), 'utf8')),
);

function run(spec: FixtureSpec) {
  const decoded = decodeSkp1(
    new Uint8Array(gunzipSync(readFileSync(here(`./keypoints/${spec.file}`)))),
  );
  if (!decoded.ok) throw new Error(`${spec.file}: ${decoded.reason}`);
  const { header, timesSec, frames: landmarks } = decoded.value;
  const config = defaultAnalysisConfig();
  const frameStep = config.metrics.frameStep[spec.mode];
  const timebase = chooseTimebase(timesSec, spec.declaredFps, config);
  const timing = timingStats(timesSec, config.gate.timing.intervalTolerance);
  const durationSec = (timesSec[timesSec.length - 1] ?? 0) - (timesSec[0] ?? 0);
  const checks = clipChecks(
    {
      decodable: true,
      effectiveFps: timebase.ok ? timebase.value.fps / frameStep : null,
      mode: spec.mode,
      irregularShare: timing.irregularShare,
      widthPx: header.widthPx,
      heightPx: header.heightPx,
      durationSec,
      calibrationPresent: spec.calibrated,
      athleteSelected: true,
      cameraShiftPx: spec.cameraShiftPx,
    },
    config.gate,
  );
  const frames: PoseFrame[] = landmarks.map((l, index) => ({
    index,
    tSec: timesSec[index] ?? 0,
    landmarks: l,
  }));
  return analyse({
    frames,
    clip: {
      widthPx: header.widthPx,
      heightPx: header.heightPx,
      frameCount: header.frameCount,
      declaredFps: spec.declaredFps,
      codec: 'fixture',
      durationSec,
    },
    timesSec: timebase.ok ? timebase.value.timesSec : timesSec,
    timebase: timebase.ok ? timebase.value.source : 'declared',
    captureFps: timebase.ok ? timebase.value.fps : spec.declaredFps,
    frameStep,
    mode: spec.mode,
    calibration: spec.calibrated
      ? {
          markerA: { x: 300, y: 900 },
          markerB: { x: 300 + 5 * spec.pxPerM, y: 900 },
          distanceM: 5,
          pxPerM: spec.pxPerM,
        }
      : null,
    clipChecks: checks,
    poseModel: { id: 'fixture', version: '1' },
    config,
    createdAt: '2026-10-28T12:00:00.000Z',
  }).result;
}

describe('keypoint fixtures', () => {
  it('has at least ten fixtures, each with provenance', () => {
    expect(manifest.fixtures.length).toBeGreaterThanOrEqual(10);
    for (const f of manifest.fixtures) {
      if (f.source === 'recorded')
        expect(f.consent, `${f.name} needs the owner's consent`).toBeDefined();
    }
  });

  for (const spec of manifest.fixtures) {
    it(`${spec.name}: ${spec.description}`, () => {
      const result = run(spec);
      expect(spec.expected.gate).toContain(result.gate.status);
      for (const id of spec.expected.failChecks) {
        expect(result.gate.checks.find((c) => c.id === id)?.level, id).toBe('fail');
      }
      for (const id of spec.expected.warnOrFailChecks ?? []) {
        expect(['warn', 'fail'], id).toContain(result.gate.checks.find((c) => c.id === id)?.level);
      }
      for (const [id, [min, max]] of Object.entries(spec.expected.metrics)) {
        const value = result.metrics.find((m) => m.id === id)?.value;
        expect(value, id).not.toBeNull();
        expect(value, id).toBeGreaterThanOrEqual(min);
        expect(value, id).toBeLessThanOrEqual(max);
      }
      if (result.gate.status === 'fail') {
        expect(result.metrics.every((m) => m.value === null)).toBe(true);
      }
    });
  }
});
