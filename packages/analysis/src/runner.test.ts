import { describe, expect, it } from 'vitest';
import { defaultConfig } from './config';
import { choosePoseModel } from './modelChoice';
import { chooseRunner, sampleFrames, type FrameDetections, type PersonBox } from './runner';

const cfg = defaultConfig.runnerDetection;
const frame = { width: 1920, height: 1080 };
const person = (x: number, y: number, width: number, height: number, score = 0.8): PersonBox => ({
  x,
  y,
  width,
  height,
  score,
});

describe('sampleFrames', () => {
  it('spreads the samples over the clip, skipping its first and last 5 percent', () => {
    const frames = sampleFrames(1000, 12);
    expect(frames).toHaveLength(12);
    expect(frames[0]).toBe(50);
    expect(frames[11]).toBe(949);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });

  it('copes with very short clips', () => {
    expect(sampleFrames(0, 12)).toEqual([]);
    expect(sampleFrames(5, 12).length).toBeGreaterThan(0);
  });
});

describe('chooseRunner', () => {
  it('finds a runner crossing the frame and pads the box', () => {
    const samples: FrameDetections[] = [0, 1, 2, 3].map((i) => ({
      frame: 100 + i * 100,
      boxes: [person(200 + i * 400, 400, 150, 400)],
    }));
    const choice = chooseRunner(samples, frame, cfg);
    expect(choice?.frame).toBe(100);
    expect(choice?.roi.width).toBeCloseTo(150 * 1.3, 5);
    expect(choice?.roi.height).toBeCloseTo(400 * 1.3, 5);
  });

  it('passes over a larger person who stands still beside the track', () => {
    const coach = person(1500, 300, 260, 700, 0.95);
    const samples: FrameDetections[] = [0, 1, 2, 3].map((i) => ({
      frame: i * 50,
      boxes: [coach, person(100 + i * 300, 450, 140, 380)],
    }));
    const choice = chooseRunner(samples, frame, cfg);
    expect(choice?.roi.height).toBeLessThan(600);
    expect(choice?.roi.x).toBeLessThan(1400);
  });

  it('prefers a runner fully in view over one cut by the frame edge', () => {
    const samples: FrameDetections[] = [
      { frame: 10, boxes: [person(0, 300, 200, 600)] },
      { frame: 20, boxes: [person(800, 350, 160, 420)] },
      { frame: 30, boxes: [person(1800, 300, 120, 600)] },
    ];
    expect(chooseRunner(samples, frame, cfg)?.frame).toBe(20);
  });

  it('ignores weak and tiny detections, and says when there is nobody', () => {
    const samples: FrameDetections[] = [
      { frame: 10, boxes: [person(500, 500, 100, 300, 0.2)] },
      { frame: 20, boxes: [person(800, 500, 20, 60)] },
      { frame: 30, boxes: [] },
    ];
    expect(chooseRunner(samples, frame, cfg)).toBeNull();
  });

  it('proposes the earliest frame where the runner is nearly as large as they get', () => {
    const samples: FrameDetections[] = [
      { frame: 10, boxes: [person(100, 300, 140, 300)] },
      { frame: 40, boxes: [person(500, 300, 150, 380)] },
      { frame: 70, boxes: [person(900, 300, 160, 400)] },
    ];
    // 380 is within 80 percent of 400; 300 is not.
    expect(chooseRunner(samples, frame, cfg)?.frame).toBe(40);
  });

  it('keeps the padded box inside the frame', () => {
    const choice = chooseRunner([{ frame: 5, boxes: [person(30, 20, 300, 1000)] }], frame, cfg);
    expect(choice?.roi.x).toBe(0);
    expect(choice?.roi.y).toBe(0);
    expect((choice?.roi.y ?? 0) + (choice?.roi.height ?? 0)).toBeLessThanOrEqual(1080);
  });
});

describe('choosePoseModel', () => {
  const pm = defaultConfig.poseModel;
  it('uses the heavy model only on a phone measured fast enough', () => {
    expect(choosePoseModel(null, pm)).toBe('full');
    expect(choosePoseModel(pm.heavyMaxMsPerFrame, pm)).toBe('heavy');
    expect(choosePoseModel(pm.heavyMaxMsPerFrame + 1, pm)).toBe('full');
    expect(choosePoseModel(Number.NaN, pm)).toBe('full');
  });
});
