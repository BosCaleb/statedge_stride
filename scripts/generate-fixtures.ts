// Generates the synthetic keypoint fixtures in fixtures/keypoints and their manifest. These
// stand in for the recorded spike fixtures until real S23 Ultra and iPhone clips are measured;
// real fixtures are added next to them with "source": "recorded" (see fixtures/README.md).
//
//   pnpm tsx scripts/generate-fixtures.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { encodeSkp1 } from '../packages/analysis/src/skp1';
import { LM, type Landmark, type PoseFrame } from '../packages/analysis/src/types';
import {
  DISTANCE_GAIT,
  generateGait,
  SPRINT_GAIT,
  type GaitOptions,
  type GaitTruth,
} from '../packages/analysis/src/testing/syntheticGait';
import type { FixtureManifest, FixtureSpec } from '../fixtures/manifestSchema';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'fixtures/keypoints');

interface Scenario {
  name: string;
  description: string;
  gait: Partial<GaitOptions>;
  mode: 'sprint' | 'distance';
  /** Edits applied to the generated frames (athlete stops, body leaves the frame). */
  edit?: (frames: PoseFrame[]) => PoseFrame[];
  /** Container timestamps scaled by this factor (a re-timed or mis-declared file). */
  timeScale?: number;
  declaredFps?: number;
  cameraShiftPx?: number;
  calibrated?: boolean;
  expected: Omit<FixtureSpec['expected'], 'metrics'>;
  /** Metrics whose values are checked against the truth, with a tolerance. */
  checkMetrics?: Partial<Record<keyof typeof truthKeys, number>>;
}

const truthKeys = {
  cadence: 'cadenceSpm',
  stride_frequency: 'strideFrequencyHz',
  contact_time: 'contactTimeMs',
  overstride: 'overstridePct',
  trunk_lean: 'trunkLeanDeg',
  step_length: 'stepLengthM',
  speed: 'speedMps',
} as const satisfies Record<string, keyof GaitTruth>;

function freezeAfter(fraction: number) {
  return (frames: PoseFrame[]) => {
    const stop = Math.floor(frames.length * fraction);
    const held = frames[stop]?.landmarks ?? null;
    return frames.map((f, i) =>
      i <= stop || !held ? f : { ...f, landmarks: held.map((l) => ({ ...l })) },
    );
  };
}

/** The near-side leg below the hip leaves the frame for the middle of the clip. */
function lowerBodyOutOfFrame(frames: PoseFrame[]): PoseFrame[] {
  const legs: number[] = [
    LM.leftKnee,
    LM.rightKnee,
    LM.leftAnkle,
    LM.rightAnkle,
    LM.leftHeel,
    LM.rightHeel,
    LM.leftFootIndex,
    LM.rightFootIndex,
  ];
  const from = Math.floor(frames.length * 0.15);
  const to = Math.floor(frames.length * 0.85);
  return frames.map((f, i) => {
    if (i < from || i > to || !f.landmarks) return f;
    const landmarks: Landmark[] = f.landmarks.map((l, idx) =>
      legs.includes(idx) ? { ...l, v: 0.05 } : l,
    );
    return { ...f, landmarks };
  });
}

const scenarios: Scenario[] = [
  {
    name: 'distance-ltr',
    description: 'Distance running, left to right, 1 px noise. A clean clip.',
    gait: { ...DISTANCE_GAIT, noisePx: 1, seed: 101 },
    mode: 'distance',
    expected: { gate: ['pass', 'conditional'], failChecks: [] },
    checkMetrics: { cadence: 2, overstride: 6, trunk_lean: 1, step_length: 0.05, speed: 0.15 },
  },
  {
    name: 'distance-rtl',
    description: 'Distance running, right to left (left leg nearest the camera), 1 px noise.',
    gait: { ...DISTANCE_GAIT, direction: -1, noisePx: 1, seed: 102 },
    mode: 'distance',
    expected: { gate: ['pass', 'conditional'], failChecks: [] },
    checkMetrics: { cadence: 2, overstride: 6, trunk_lean: 1, step_length: 0.05 },
  },
  {
    name: 'sprint-ltr',
    description: 'Sprinting, left to right, 1 px noise.',
    gait: { ...SPRINT_GAIT, noisePx: 1, seed: 103 },
    mode: 'sprint',
    expected: { gate: ['pass', 'conditional'], failChecks: [] },
    checkMetrics: {
      cadence: 3,
      stride_frequency: 0.06,
      contact_time: 25,
      trunk_lean: 1,
      speed: 0.2,
    },
  },
  {
    name: 'sprint-rtl',
    description: 'Sprinting, right to left, 1 px noise.',
    gait: { ...SPRINT_GAIT, direction: -1, noisePx: 1, seed: 104 },
    mode: 'sprint',
    expected: { gate: ['pass', 'conditional'], failChecks: [] },
    checkMetrics: { cadence: 3, contact_time: 25, trunk_lean: 1 },
  },
  {
    name: 'occluded-far-leg',
    description: 'The far leg is often hidden: low far-side visibility and frequent drop-outs.',
    gait: { ...DISTANCE_GAIT, noisePx: 1.5, farVisibility: 0.55, dropoutRate: 0.06, seed: 105 },
    mode: 'distance',
    expected: { gate: ['pass', 'conditional'], failChecks: [] },
    checkMetrics: { cadence: 3 },
  },
  {
    name: 'camera-moved',
    description: 'Good keypoints, but the camera moved 20 px against the calibration frame.',
    gait: { ...DISTANCE_GAIT, noisePx: 1, seed: 106 },
    mode: 'distance',
    cameraShiftPx: 20,
    expected: { gate: ['fail'], failChecks: ['camera_stable'] },
  },
  {
    name: 'wrong-mode-30fps',
    description: 'Recorded in normal video mode (30 fps) instead of slow motion.',
    gait: { ...DISTANCE_GAIT, fps: 30, noisePx: 1, seed: 107 },
    mode: 'distance',
    declaredFps: 30,
    expected: { gate: ['fail'], failChecks: ['fps_ok'] },
  },
  {
    name: 'wrong-frame-rate',
    description:
      'A 240 fps capture treated as 960 fps (the Super slow-mo mix-up), so cadence comes out absurd.',
    gait: {
      ...DISTANCE_GAIT,
      speedMps: 3,
      pxPerM: 120,
      cadenceSpm: 170,
      contactTimeMs: 240,
      noisePx: 1,
      seed: 108,
    },
    mode: 'distance',
    timeScale: 0.25,
    declaredFps: 960,
    expected: { gate: ['fail'], failChecks: ['timebase_plausible'] },
  },
  {
    name: 'athlete-stops',
    description: 'The athlete stops 40 percent of the way through the clip.',
    gait: { ...DISTANCE_GAIT, noisePx: 1, seed: 109 },
    mode: 'distance',
    edit: freezeAfter(0.4),
    expected: { gate: ['fail'], failChecks: ['steady_direction'] },
  },
  {
    name: 'body-out-of-frame',
    description: 'The legs leave the bottom of the frame for most of the clip.',
    gait: { ...DISTANCE_GAIT, noisePx: 1, seed: 110 },
    mode: 'distance',
    edit: lowerBodyOutOfFrame,
    expected: { gate: ['fail'], failChecks: ['body_visible'] },
  },
  {
    name: 'side-labels-mismatch',
    description:
      'The far side looks clearer than the near side, so left and right labels are uncertain.',
    gait: { ...DISTANCE_GAIT, noisePx: 1, nearVisibility: 0.7, farVisibility: 0.95, seed: 111 },
    mode: 'distance',
    expected: { gate: ['conditional'], failChecks: [], warnOrFailChecks: ['side_labels'] },
  },
];

await mkdir(outDir, { recursive: true });
const manifest: FixtureManifest = { version: 1, fixtures: [] };
for (const s of scenarios) {
  const clip = generateGait(s.gait);
  const frames = s.edit ? s.edit(clip.frames) : clip.frames;
  const times = Float64Array.from(clip.timesSec, (t) => t * (s.timeScale ?? 1));
  const bytes = encodeSkp1({
    widthPx: clip.clip.widthPx,
    heightPx: clip.clip.heightPx,
    mirrored: false,
    timesSec: times,
    frames: frames.map((f) => f.landmarks),
  });
  const file = `${s.name}.skp1.gz`;
  await writeFile(join(outDir, file), gzipSync(bytes, { level: 9 }));
  const metrics: Record<string, [number, number]> = {};
  for (const [id, tolerance] of Object.entries(s.checkMetrics ?? {})) {
    const truth = clip.truth[truthKeys[id as keyof typeof truthKeys]];
    metrics[id] = [truth - (tolerance ?? 0), truth + (tolerance ?? 0)];
  }
  manifest.fixtures.push({
    name: s.name,
    file,
    source: 'synthetic',
    description: s.description,
    mode: s.mode,
    declaredFps: s.declaredFps ?? clip.clip.declaredFps,
    pxPerM: clip.truth.legLengthPx / (s.gait.legLengthM ?? DISTANCE_GAIT.legLengthM),
    calibrated: s.calibrated ?? true,
    cameraShiftPx: s.cameraShiftPx ?? 1,
    expected: { ...s.expected, metrics },
  });
  console.log(`${file}: ${frames.length} frames, ${bytes.byteLength} bytes before gzip`);
}
await writeFile(join(root, 'fixtures/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${manifest.fixtures.length} fixtures`);
