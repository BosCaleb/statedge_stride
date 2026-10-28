import { analysisResultSchema } from '@stride/shared/analysisResult';
import { describe, expect, it } from 'vitest';
import { defaultAnalysisConfig } from './config';
import { rawTrackFromFrames } from './clean';
import { assessSides, countAnkleSwaps, mirrorTrack, travelDirection } from './orientation';
import { generateGait, SPRINT_GAIT } from './testing/syntheticGait';
import { runSynthetic } from './testing/runSynthetic';
import { LM, type PoseFrame } from './types';

const config = defaultAnalysisConfig();

function rawOf(frames: PoseFrame[], n: number, times: Float64Array) {
  return rawTrackFromFrames(frames, n, 1, times, 1920, 1080);
}

describe('analyse', () => {
  it('produces a result that matches the stored result schema', () => {
    const { result } = runSynthetic(generateGait({ noisePx: 1 }), { mode: 'distance' });
    expect(() => analysisResultSchema.parse(result)).not.toThrow();
    expect(result.algorithmVersion).toBeTruthy();
    expect(result.configSnapshot).toEqual(config);
  });

  it('chooses key frames from a near-side stance where both methods agree', () => {
    const { result } = runSynthetic(generateGait({}), { mode: 'distance' });
    expect(result.keyFrames).not.toBeNull();
    const kf = result.keyFrames;
    if (!kf) return;
    expect(kf.side).toBe('right');
    expect(kf.icFrame).toBeLessThan(kf.midFrame);
    expect(kf.midFrame).toBeLessThan(kf.toFrame);
    expect(result.events.some((e) => e.icFrame === kf.icFrame && e.agreement === 'both')).toBe(
      true,
    );
  });

  it('stops before pose-dependent work when a clip-level check fails', () => {
    const clip = generateGait({});
    const { result } = runSynthetic(clip, { mode: 'distance', cameraShiftPx: 40 });
    expect(result.gate.status).toBe('fail');
    expect(result.metrics).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.gate.checks.find((c) => c.id === 'camera_stable')?.level).toBe('fail');
  });

  it('is conditional without a calibration and hides the scaled metrics', () => {
    const { result } = runSynthetic(generateGait({}), { mode: 'distance', calibration: null });
    expect(result.gate.status).toBe('conditional');
    expect(result.calibration).toBeNull();
    expect(result.gate.hiddenMetrics.sort()).toEqual(['speed', 'step_length', 'stride_length']);
    const vo = result.metrics.find((m) => m.id === 'vertical_oscillation');
    expect(vo?.value).not.toBeNull();
    expect(vo?.secondary?.value).toBeNull();
  });

  it('fails the gate when the declared frame rate is wrong (Super slow-mo)', () => {
    // A 240 fps capture analysed as if it were 960 fps: steps look four times too fast.
    const clip = generateGait({});
    const wrong = {
      ...clip,
      timesSec: clip.timesSec.map((t) => t / 4),
      clip: { ...clip.clip, declaredFps: 960 },
    };
    const { result } = runSynthetic(wrong, { mode: 'distance' });
    expect(result.gate.status).toBe('fail');
    expect(result.metrics.every((m) => m.value === null)).toBe(true);
  });

  it('runs for sprint mode and keeps only finite numbers', () => {
    const { result } = runSynthetic(generateGait({ ...SPRINT_GAIT, noisePx: 2 }), {
      mode: 'sprint',
    });
    for (const m of result.metrics) {
      if (m.value !== null) expect(Number.isFinite(m.value)).toBe(true);
    }
    expect(result.mode).toBe('sprint');
  });
});

describe('orientation and sides', () => {
  it('detects the direction of travel and mirrors x', () => {
    const clip = generateGait({ direction: -1 });
    const raw = rawOf(clip.frames, clip.clip.frameCount, clip.timesSec);
    const travel = travelDirection(raw, 135, config);
    expect(travel.direction).toBe(-1);
    expect(travel.determined).toBe(true);
    const mirrored = mirrorTrack(raw);
    expect(travelDirection(mirrored, 135, config).direction).toBe(1);
    expect(mirrored.x[LM.nose]?.[0]).toBeCloseTo(1920 - (raw.x[LM.nose]?.[0] ?? 0), 9);
  });

  it('accepts side labels that match the direction of travel', () => {
    for (const direction of [1, -1] as const) {
      const clip = generateGait({ direction });
      const raw = rawOf(clip.frames, clip.clip.frameCount, clip.timesSec);
      const sides = assessSides(raw, direction, 135, config);
      expect(sides.nearSide).toBe(direction === 1 ? 'right' : 'left');
      expect(sides.mismatch).toBe(false);
      expect(sides.uncertain).toBe(false);
    }
  });

  it('flags labels that disagree with the direction of travel', () => {
    // Visibility says the left side is nearest, but the athlete runs left to right.
    const clip = generateGait({ nearVisibility: 0.7, farVisibility: 0.95 });
    const raw = rawOf(clip.frames, clip.clip.frameCount, clip.timesSec);
    const sides = assessSides(raw, 1, 135, config);
    expect(sides.mismatch).toBe(true);
    expect(sides.uncertain).toBe(true);
    const { result } = runSynthetic(clip, { mode: 'distance' });
    expect(result.gate.checks.find((c) => c.id === 'side_labels')?.level).toBe('warn');
    const overstride = result.metrics.find((m) => m.id === 'overstride');
    expect(overstride?.confidence).toBe('low');
    expect(overstride?.reasons).toContain('side_labels_uncertain');
  });

  it('counts ankle label swaps mid-clip', () => {
    const clip = generateGait({});
    const frames = clip.frames.map((f) => {
      if (f.index < 200 || !f.landmarks) return f;
      const lm = [...f.landmarks];
      const left = lm[LM.leftAnkle];
      const right = lm[LM.rightAnkle];
      if (left && right) {
        lm[LM.leftAnkle] = right;
        lm[LM.rightAnkle] = left;
      }
      return { ...f, landmarks: lm };
    });
    const raw = rawOf(frames, clip.clip.frameCount, clip.timesSec);
    expect(countAnkleSwaps(raw, 135, config)).toBeGreaterThanOrEqual(1);
    const clean = rawOf(clip.frames, clip.clip.frameCount, clip.timesSec);
    expect(countAnkleSwaps(clean, 135, config)).toBe(0);
  });
});
