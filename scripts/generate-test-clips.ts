// Renders the synthetic end-to-end test clips with ffmpeg (no people are filmed):
//   fixtures/clips/synthetic-run-240fps.mp4          a stick-figure runner, the same gait as the
//                                                    distance-ltr keypoint fixture, frame for frame
//   fixtures/clips/synthetic-calibration-240fps.mp4  the empty scene with two cones 5 m apart
// VP9 in MP4, because the open-source Chromium used by Playwright has no H.264 decoder.
//
//   pnpm tsx scripts/generate-test-clips.ts   (needs ffmpeg with libvpx-vp9 on the PATH)

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateGait, DISTANCE_GAIT } from '../packages/analysis/src/testing/syntheticGait';
import { LM, type Landmark } from '../packages/analysis/src/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1920;
const H = 1080;
const FPS = 240;
type Rgb = [number, number, number];

function background(): Uint8Array {
  const img = new Uint8Array(W * H * 3);
  const ground = Math.round(DISTANCE_GAIT.groundShare * H);
  for (let y = 0; y < H; y++) {
    const colour: Rgb =
      y < ground - 140 ? [196, 220, 236] : y < ground + 6 ? [176, 88, 64] : [160, 78, 58];
    for (let x = 0; x < W; x++) img.set(colour, (y * W + x) * 3);
  }
  for (const ly of [ground - 140, ground + 70]) fillRect(img, 0, ly, W, 5, [240, 240, 240]);
  return img;
}

function fillRect(img: Uint8Array, x0: number, y0: number, w: number, h: number, c: Rgb) {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) img.set(c, (y * W + x) * 3);
  }
}

function disc(img: Uint8Array, cx: number, cy: number, r: number, c: Rgb) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) img.set(c, (y * W + x) * 3);
    }
  }
}

function line(img: Uint8Array, a: Landmark, b: Landmark, r: number, c: Rgb) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r / 2)) + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(img, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r, c);
  }
}

function cone(img: Uint8Array, x: number, groundY: number) {
  for (let i = 0; i < 40; i++)
    fillRect(
      img,
      Math.round(x - 14 + i * 0.35),
      groundY - i,
      Math.round(28 - i * 0.7),
      1,
      [244, 120, 32],
    );
}

const BONES: [number, number][] = [
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.leftAnkle, LM.leftHeel],
  [LM.leftHeel, LM.leftFootIndex],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.rightAnkle, LM.rightHeel],
  [LM.rightHeel, LM.rightFootIndex],
];

function encode(
  file: string,
  frames: number,
  draw: (i: number, img: Uint8Array) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-s',
        `${W}x${H}`,
        '-r',
        String(FPS),
        '-i',
        '-',
        '-c:v',
        'libvpx-vp9',
        '-b:v',
        '0',
        '-crf',
        '50',
        '-deadline',
        'realtime',
        '-cpu-used',
        '8',
        '-row-mt',
        '1',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        file,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
    const img = new Uint8Array(W * H * 3);
    let i = 0;
    const pump = () => {
      while (i < frames) {
        draw(i++, img);
        if (!ffmpeg.stdin.write(img)) {
          ffmpeg.stdin.once('drain', pump);
          return;
        }
      }
      ffmpeg.stdin.end();
    };
    pump();
  });
}

const scene = background();
const groundY = Math.round(DISTANCE_GAIT.groundShare * H);
const conesAt = [W / 2 - 2.5 * DISTANCE_GAIT.pxPerM, W / 2 + 2.5 * DISTANCE_GAIT.pxPerM];
for (const x of conesAt) cone(scene, x, groundY);

// The same gait as fixtures/keypoints/distance-ltr, drawn without noise.
const clip = generateGait({ ...DISTANCE_GAIT, noisePx: 0, seed: 101 });
const run = join(root, 'fixtures/clips/synthetic-run-240fps.mp4');
await encode(run, clip.frames.length, (i, img) => {
  img.set(scene);
  const lm = clip.frames[i]?.landmarks;
  if (!lm) return;
  for (const [a, b] of BONES) line(img, lm[a] as Landmark, lm[b] as Landmark, 5, [13, 28, 62]);
  const nose = lm[LM.nose] as Landmark;
  disc(
    img,
    nose.x - 0.06 * clip.truth.legLengthPx,
    nose.y,
    0.09 * clip.truth.legLengthPx,
    [13, 28, 62],
  );
});
console.log(`${run}: ${clip.frames.length} frames`);

const calibration = join(root, 'fixtures/clips/synthetic-calibration-240fps.mp4');
await encode(calibration, 3 * FPS, (_i, img) => img.set(scene));
console.log(
  `${calibration}: ${3 * FPS} frames, cones at x = ${conesAt.join(' and ')} on y = ${groundY}`,
);
