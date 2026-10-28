import type { ClipSummary } from '@stride/shared/analysisResult';
import type { Side } from '@stride/shared/enums';
import { angleFromDownVertical, interiorAngle } from '../geometry';
import { gaussian, seededRandom } from '../stats';
import {
  LANDMARK_COUNT,
  LM,
  SIDE_LANDMARKS,
  type Landmark,
  type Point,
  type PoseFrame,
} from '../types';

// A synthetic running skeleton for tests: a side-on runner with chosen cadence, contact time,
// leg length, trunk lean, knee angle and overstride, with Gaussian noise and runs of dropped
// landmarks. The generator also returns the ground truth that the metrics should recover.

export interface GaitOptions {
  fps: number;
  widthPx: number;
  heightPx: number;
  cadenceSpm: number;
  contactTimeMs: number;
  /** Real leg length; with pxPerM this sets the leg length in pixels. */
  legLengthM: number;
  pxPerM: number;
  speedMps: number;
  trunkLeanDeg: number;
  /** 180 minus the interior knee angle at initial contact. */
  kneeFlexionIcDeg: number;
  /** Heel ahead of the mid-hip at initial contact, as a percentage of leg length. */
  overstridePct: number;
  /** Peak-to-peak vertical travel of the mid-hip. */
  verticalOscillationCm: number;
  /** Upper-arm swing amplitude either side of vertical; the range is twice this. */
  armSwingDeg: number;
  /** 1 runs left to right in the image, -1 right to left. */
  direction: 1 | -1;
  /** Standard deviation of Gaussian noise on every landmark coordinate. */
  noisePx: number;
  /** Share of landmark samples that drop out, in runs of about three frames. */
  dropoutRate: number;
  nearVisibility: number;
  farVisibility: number;
  /** Ground line height as a share of the frame height. */
  groundShare: number;
  seed: number;
}

export const DISTANCE_GAIT: GaitOptions = {
  fps: 240,
  widthPx: 1920,
  heightPx: 1080,
  cadenceSpm: 176,
  contactTimeMs: 220,
  legLengthM: 0.9,
  pxPerM: 150,
  speedMps: 4,
  trunkLeanDeg: 6,
  kneeFlexionIcDeg: 18,
  overstridePct: 22,
  verticalOscillationCm: 8,
  armSwingDeg: 30,
  direction: 1,
  noisePx: 0,
  dropoutRate: 0,
  nearVisibility: 0.95,
  farVisibility: 0.8,
  groundShare: 0.85,
  seed: 1,
};

export const SPRINT_GAIT: GaitOptions = {
  ...DISTANCE_GAIT,
  cadenceSpm: 270,
  contactTimeMs: 110,
  speedMps: 7.5,
  trunkLeanDeg: 10,
  kneeFlexionIcDeg: 25,
  overstridePct: 12,
  verticalOscillationCm: 5,
  armSwingDeg: 45,
};

export interface TruthEvent {
  side: Side;
  icTimeSec: number;
  toTimeSec: number;
}

export interface GaitTruth {
  events: TruthEvent[];
  legLengthPx: number;
  cadenceSpm: number;
  strideFrequencyHz: number;
  contactTimeMs: number;
  flightTimeMs: number;
  stepLengthM: number;
  strideLengthM: number;
  speedMps: number;
  overstridePct: number;
  trunkLeanDeg: number;
  /** Mean over the initial contacts inside the clip, measured on the noise-free skeleton. */
  kneeFlexionIcDeg: number;
  shinAngleIcDeg: number;
  verticalOscillationPct: number;
  verticalOscillationCm: number;
  armSwingRangeDeg: number;
}

export interface SyntheticClip {
  frames: PoseFrame[];
  timesSec: Float64Array;
  clip: ClipSummary;
  truth: GaitTruth;
}

const MIRROR_PAIRS: readonly [number, number][] = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

/**
 * Share of the swing distance covered at swing progress u, for a speed profile that rises from
 * 60 percent of cruise at toe-off to cruise by u = 0.25, holds, and brakes hard to 5 percent over
 * the last 4 percent before contact. With this profile the foot is furthest ahead of the hip
 * about 10 ms before contact and furthest behind just after toe-off, close to the errors
 * reported for the Zeni method in running.
 */
function swingProgress(u: number): number {
  const a0 = 0.6;
  const a1 = 0.05;
  const rampEnd = 0.25;
  const brakeStart = 0.96;
  const ramp = (x: number) => a0 * x + ((1 - a0) * x * x) / (2 * rampEnd);
  const brake = (x: number) => x - ((1 - a1) * x * x) / (2 * (1 - brakeStart));
  const total = ramp(rampEnd) + (brakeStart - rampEnd) + brake(1 - brakeStart);
  let covered: number;
  if (u <= rampEnd) covered = ramp(u);
  else if (u <= brakeStart) covered = ramp(rampEnd) + (u - rampEnd);
  else covered = ramp(rampEnd) + (brakeStart - rampEnd) + brake(u - brakeStart);
  return covered / total;
}

function add(p: Point, dx: number, dy: number): Point {
  return { x: p.x + dx, y: p.y + dy };
}

/** Knee position from hip and ankle with the knee in front; stretched straight when out of reach. */
function solveKnee(hip: Point, ankle: Point, thigh: number, shank: number): Point {
  const dx = ankle.x - hip.x;
  const dy = ankle.y - hip.y;
  const d = Math.hypot(dx, dy);
  if (d >= thigh + shank - 1e-9 || d === 0) {
    const share = thigh / (thigh + shank);
    return { x: hip.x + dx * share, y: hip.y + dy * share };
  }
  const ux = dx / d;
  const uy = dy / d;
  const cosPhi = (thigh * thigh + d * d - shank * shank) / (2 * thigh * d);
  const phi = Math.acos(Math.min(1, Math.max(-1, cosPhi)));
  const candidates = [phi, -phi].map((a) => ({
    x: hip.x + thigh * (ux * Math.cos(a) - uy * Math.sin(a)),
    y: hip.y + thigh * (ux * Math.sin(a) + uy * Math.cos(a)),
  }));
  // Forward of the hip-to-ankle line: normal (uy, -ux) points forward when the leg points down.
  const forward = (k: Point) => (k.x - hip.x) * uy - (k.y - hip.y) * ux;
  const [a, b] = candidates as [Point, Point];
  return forward(a) >= forward(b) ? a : b;
}

interface Foot {
  heel: Point;
  toe: Point;
  ankle: Point;
}

/** Synthesises the running skeleton and its ground truth. */
export function generateGait(options: Partial<GaitOptions> = {}): SyntheticClip {
  const o: GaitOptions = { ...DISTANCE_GAIT, ...options };
  const random = seededRandom(o.seed);
  const L = o.legLengthM * o.pxPerM;
  const thigh = L / 2;
  const shank = L / 2;
  const footLength = 0.25 * L;
  const ground = o.groundShare * o.heightPx;
  const stepSec = 60 / o.cadenceSpm;
  const strideSec = 2 * stepSec;
  const contactSec = o.contactTimeMs / 1000;
  const swingSec = strideSec - contactSec;
  const speedPx = o.speedMps * o.pxPerM;
  const overstridePx = (o.overstridePct / 100) * L;
  const vo = (o.verticalOscillationCm / 100) * o.pxPerM;
  const lean = (o.trunkLeanDeg * Math.PI) / 180;
  const pitchIc = (12 * Math.PI) / 180;
  const pitchTo = (35 * Math.PI) / 180;
  const ankleOffset = (pitch: number) => ({
    x: 0.06 * L * Math.cos(pitch) - 0.1 * L * Math.sin(pitch),
    y: -0.1 * L * Math.cos(pitch) - 0.06 * L * Math.sin(pitch),
  });

  // The athlete crosses the frame from 8 percent to 92 percent of the width.
  const startX = 0.08 * o.widthPx + overstridePx + footLength;
  const durationSec = (0.84 * o.widthPx - 2 * (overstridePx + footLength)) / speedPx;
  const n = Math.floor(durationSec * o.fps);
  const firstIc = 0.37 * stepSec;

  // Hip height chosen so that the knee is flexed by kneeFlexionIcDeg at initial contact.
  const dIc = L * Math.sin(((180 - o.kneeFlexionIcDeg) * Math.PI) / 360);
  const icAnkle = ankleOffset(pitchIc);
  const dxIc = overstridePx + icAnkle.x;
  const hipAboveAnkleIc = Math.sqrt(Math.max(0, dIc * dIc - dxIc * dxIc));
  const hipYAtIc = ground + icAnkle.y - hipAboveAnkleIc;
  const baseY = hipYAtIc - (vo / 2) * Math.cos((Math.PI * contactSec) / stepSec);

  const midHipAt = (t: number): Point => {
    // Lowest (largest y) at mid-stance of each step.
    const phase = (t - firstIc - contactSec / 2) / stepSec;
    return { x: startX + speedPx * t, y: baseY + (vo / 2) * Math.cos(2 * Math.PI * phase) };
  };

  /** Initial contact time of the stance of `side` that is in progress or most recent at t. */
  const lastIc = (side: Side, t: number) => {
    const offset = side === 'right' ? 0 : stepSec;
    const j = Math.floor((t - firstIc - offset) / strideSec);
    return firstIc + offset + j * strideSec;
  };

  const footAt = (side: Side, t: number): Foot => {
    const ic = lastIc(side, t);
    const since = t - ic;
    const contactX = midHipAt(ic).x + overstridePx;
    const toeX = contactX + footLength;
    if (since < contactSec) {
      const s = since / contactSec;
      let heel: Point;
      let toe: Point;
      let pitch: number;
      if (s < 0.15) {
        pitch = pitchIc * (1 - s / 0.15);
        heel = { x: contactX, y: ground };
        toe = {
          x: contactX + footLength * Math.cos(pitch),
          y: ground - footLength * Math.sin(pitch),
        };
      } else if (s <= 0.6) {
        pitch = 0;
        heel = { x: contactX, y: ground };
        toe = { x: toeX, y: ground };
      } else {
        pitch = -pitchTo * ((s - 0.6) / 0.4);
        toe = { x: toeX, y: ground };
        heel = { x: toeX - footLength * Math.cos(pitch), y: ground + footLength * Math.sin(pitch) };
      }
      const off = ankleOffset(pitch);
      return { heel, toe, ankle: add(heel, off.x, off.y) };
    }
    // Swing: the heel travels from its toe-off position to the next contact, lifted on the way.
    const u = Math.min(1, (since - contactSec) / swingSec);
    const heelTo = {
      x: toeX - footLength * Math.cos(pitchTo),
      y: ground - footLength * Math.sin(pitchTo),
    };
    const nextContactX = midHipAt(ic + strideSec).x + overstridePx;
    const travel = nextContactX - heelTo.x;
    const eased = swingProgress(u);
    const lift = 0.35 * L * Math.sin(Math.PI * u);
    const heel = { x: heelTo.x + travel * eased, y: heelTo.y + (ground - heelTo.y) * u - lift };
    const pitch = -pitchTo + (pitchTo + pitchIc) * smoothstep(u);
    const toe = {
      x: heel.x + footLength * Math.cos(pitch),
      y: heel.y - footLength * Math.sin(pitch),
    };
    const off = ankleOffset(pitch);
    return { heel, toe, ankle: add(heel, off.x, off.y) };
  };

  const skeletonAt = (t: number): Point[] => {
    const pts: Point[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0 }));
    const m = midHipAt(t);
    const trunk = 0.55 * L;
    const s = { x: m.x + trunk * Math.sin(lean), y: m.y - trunk * Math.cos(lean) };
    const sideOffset = { left: -0.02 * L, right: 0.02 * L };
    for (const side of ['left', 'right'] as const) {
      const ids = SIDE_LANDMARKS[side];
      const hip = add(m, sideOffset[side], 0);
      const shoulder = add(s, sideOffset[side], 0);
      const foot = footAt(side, t);
      pts[ids.hip] = hip;
      pts[ids.shoulder] = shoulder;
      pts[ids.heel] = foot.heel;
      pts[ids.footIndex] = foot.toe;
      pts[ids.ankle] = foot.ankle;
      pts[ids.knee] = solveKnee(hip, foot.ankle, thigh, shank);
      // Arms swing opposite to the leg on the same side: back at that foot's initial contact.
      const armPhase = (2 * Math.PI * (t - lastIc(side, t))) / strideSec;
      const arm = (-o.armSwingDeg * Math.cos(armPhase) * Math.PI) / 180;
      const elbow = {
        x: shoulder.x + 0.35 * L * Math.sin(arm),
        y: shoulder.y + 0.35 * L * Math.cos(arm),
      };
      const forearm = arm + (80 * Math.PI) / 180;
      const wrist = {
        x: elbow.x + 0.3 * L * Math.sin(forearm),
        y: elbow.y + 0.3 * L * Math.cos(forearm),
      };
      pts[ids.elbow] = elbow;
      pts[ids.wrist] = wrist;
      const hand = side === 'left' ? [17, 19, 21] : [18, 20, 22];
      for (const h of hand) pts[h] = add(wrist, 0.03 * L, 0.02 * L);
    }
    const nose = { x: s.x + 0.12 * L, y: s.y - 0.33 * L };
    pts[LM.nose] = nose;
    for (const f of [1, 2, 3, 4, 5, 6]) pts[f] = add(nose, -0.03 * L, -0.03 * L);
    pts[7] = add(nose, -0.1 * L, -0.01 * L);
    pts[8] = add(nose, -0.1 * L, -0.01 * L);
    pts[9] = add(nose, -0.01 * L, 0.04 * L);
    pts[10] = add(nose, -0.01 * L, 0.04 * L);
    return pts;
  };

  // Visibility: the near side (right when running left to right) is clearer than the far side.
  const nearIds = new Set(
    Object.values(SIDE_LANDMARKS.right).concat([12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]),
  );
  const farIds = new Set(
    Object.values(SIDE_LANDMARKS.left).concat([11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]),
  );
  const visibilityOf = (l: number) =>
    nearIds.has(l) ? o.nearVisibility : farIds.has(l) ? o.farVisibility : 0.98;
  const meanRun = 3;
  const dropping = new Array<boolean>(LANDMARK_COUNT).fill(false);

  const frames: PoseFrame[] = [];
  const timesSec = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / o.fps;
    timesSec[i] = t;
    const pts = skeletonAt(t);
    const landmarks: Landmark[] = pts.map((p, l) => {
      if (o.dropoutRate > 0) {
        if (dropping[l]) dropping[l] = random() >= 1 / meanRun;
        else dropping[l] = random() < o.dropoutRate / meanRun;
      }
      if (dropping[l]) {
        return {
          x: p.x + gaussian(random) * 25,
          y: p.y + gaussian(random) * 25,
          v: 0.1 + 0.2 * random(),
        };
      }
      return {
        x: p.x + gaussian(random) * o.noisePx,
        y: p.y + gaussian(random) * o.noisePx,
        v: visibilityOf(l),
      };
    });
    frames.push({
      index: i,
      tSec: t,
      landmarks: o.direction === 1 ? landmarks : mirror(landmarks, o.widthPx),
    });
  }

  // Ground truth.
  const events: TruthEvent[] = [];
  for (let ic = firstIc; ic < durationSec; ic += stepSec) {
    const index = Math.round((ic - firstIc) / stepSec);
    const side: Side = index % 2 === 0 ? 'right' : 'left';
    if (ic + contactSec < durationSec)
      events.push({ side, icTimeSec: ic, toTimeSec: ic + contactSec });
  }
  const knees: number[] = [];
  const shins: number[] = [];
  for (const e of events) {
    const i = Math.ceil(e.icTimeSec * o.fps - 1e-9);
    const pts = skeletonAt(i / o.fps);
    const ids = SIDE_LANDMARKS[e.side];
    const hip = pts[ids.hip] as Point;
    const knee = pts[ids.knee] as Point;
    const ankle = pts[ids.ankle] as Point;
    knees.push(180 - interiorAngle(hip, knee, ankle));
    shins.push(angleFromDownVertical(knee, ankle));
  }
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  const truth: GaitTruth = {
    events:
      o.direction === 1
        ? events
        : events.map((e) => ({ ...e, side: e.side === 'left' ? 'right' : 'left' })),
    legLengthPx: L,
    cadenceSpm: o.cadenceSpm,
    strideFrequencyHz: 1 / strideSec,
    contactTimeMs: o.contactTimeMs,
    flightTimeMs: (stepSec - contactSec) * 1000,
    stepLengthM: o.speedMps * stepSec,
    strideLengthM: o.speedMps * strideSec,
    speedMps: o.speedMps,
    overstridePct: o.overstridePct,
    trunkLeanDeg: o.trunkLeanDeg,
    kneeFlexionIcDeg: avg(knees),
    shinAngleIcDeg: avg(shins),
    verticalOscillationPct: (vo / L) * 100,
    verticalOscillationCm: o.verticalOscillationCm,
    armSwingRangeDeg: 2 * o.armSwingDeg,
  };
  return {
    frames,
    timesSec,
    clip: {
      widthPx: o.widthPx,
      heightPx: o.heightPx,
      frameCount: n,
      declaredFps: o.fps,
      codec: 'synthetic',
      durationSec: n / o.fps,
    },
    truth,
  };
}

/** Mirrors the image horizontally and swaps left and right labels (a runner going the other way). */
function mirror(landmarks: Landmark[], width: number): Landmark[] {
  const out = landmarks.map((lm) => ({ ...lm, x: width - lm.x }));
  for (const [a, b] of MIRROR_PAIRS) {
    const tmp = out[a] as Landmark;
    out[a] = out[b] as Landmark;
    out[b] = tmp;
  }
  return out;
}
