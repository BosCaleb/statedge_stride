import { defaultAnalysisConfig } from '@stride/analysis/config';
import type { Landmark } from '@stride/analysis/types';
import { describe, expect, it } from 'vitest';
import { clampSquare, confidentBox, fromCrop, RoiTracker, squareAround } from './roi';

const config = defaultAnalysisConfig();

function athleteAt(x: number, y: number, size = 300, v = 0.9): Landmark[] {
  return Array.from({ length: 33 }, (_, i) => ({
    x: x + ((i * 37) % size),
    y: y + ((i * 53) % size),
    v,
  }));
}

describe('crop geometry', () => {
  it('makes a square around the box, enlarged by 40 percent', () => {
    const crop = squareAround({ x: 800, y: 300, width: 200, height: 500 }, 0.4, 384, 1920, 1080);
    expect(crop.width).toBe(700);
    expect(crop.height).toBe(700);
    expect(crop.x + crop.width / 2).toBeCloseTo(900, 6);
    expect(crop.y + crop.height / 2).toBeCloseTo(550, 6);
  });

  it('is at least 384 px', () => {
    const crop = squareAround({ x: 900, y: 500, width: 50, height: 120 }, 0.4, 384, 1920, 1080);
    expect(crop.width).toBe(384);
  });

  it('is clamped to the frame', () => {
    const crop = clampSquare(10, 1070, 600, 1920, 1080);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(480);
    expect(clampSquare(960, 540, 5000, 1920, 1080).width).toBe(1080);
  });

  it('maps normalised crop landmarks back to full-frame pixels', () => {
    const [p] = fromCrop([{ x: 0.5, y: 0.25, visibility: 1.2 }], {
      x: 100,
      y: 200,
      width: 400,
      height: 400,
    });
    expect(p).toEqual({ x: 300, y: 300, v: 1 });
  });

  it('boxes only confident landmarks, and needs at least four', () => {
    const lm = athleteAt(500, 300, 200);
    lm[0] = { x: 5, y: 5, v: 0.1 };
    const box = confidentBox(lm, 0.5);
    expect(box?.x).toBeGreaterThanOrEqual(500);
    expect(confidentBox(lm.slice(0, 3), 0.5)).toBeNull();
  });
});

describe('RoiTracker', () => {
  it('follows the athlete and retries with the enlarged initial box', () => {
    const tracker = new RoiTracker({ x: 100, y: 300, width: 200, height: 400 }, 1920, 1080, config);
    expect(tracker.update(0, athleteAt(700, 400))).toEqual({ kind: 'tracked' });
    const crop = tracker.crop();
    expect(crop.x).toBeGreaterThan(400);
    const retry = tracker.retryCrop();
    expect(retry.width).toBe(600); // 400 * 1.5
  });

  it('reports the end of the pass when the athlete leaves at the side of the frame', () => {
    const tracker = new RoiTracker(
      { x: 1500, y: 300, width: 200, height: 400 },
      1920,
      1080,
      config,
    );
    tracker.update(0, athleteAt(1700, 400, 220));
    let step = tracker.update(1, null);
    for (let f = 2; step.kind === 'missed'; f++) step = tracker.update(f, null);
    expect(step.kind).toBe('exited');
  });

  it('reports tracking lost, with the frame range, in the middle of the frame', () => {
    const tracker = new RoiTracker({ x: 800, y: 300, width: 200, height: 400 }, 1920, 1080, config);
    tracker.update(10, athleteAt(800, 400));
    let step = tracker.update(11, null);
    let f = 12;
    for (; step.kind === 'missed'; f++) step = tracker.update(f, null);
    expect(step).toEqual({ kind: 'lost', fromFrame: 11, toFrame: f - 1 });
    expect(f - 1 - 11).toBe(config.roi.maxConsecutiveMisses);
  });

  it('reports never found when no person was ever detected', () => {
    const tracker = new RoiTracker({ x: 800, y: 300, width: 200, height: 400 }, 1920, 1080, config);
    let step = tracker.update(0, null);
    for (let f = 1; step.kind === 'missed'; f++) step = tracker.update(f, null);
    expect(step.kind).toBe('never_found');
  });
});
