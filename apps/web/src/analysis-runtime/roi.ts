import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { Landmark, Roi } from '@stride/analysis/types';

// Region-of-interest tracking. The athlete is small in the frame, so the model sees a square
// crop around them, which raises the effective resolution. Pure geometry, unit-tested.

export function clampSquare(
  cx: number,
  cy: number,
  size: number,
  frameW: number,
  frameH: number,
): Roi {
  const side = Math.min(size, frameW, frameH);
  const x = Math.min(Math.max(0, cx - side / 2), frameW - side);
  const y = Math.min(Math.max(0, cy - side / 2), frameH - side);
  return { x, y, width: side, height: side };
}

/** A square around `box`, enlarged by `share`, at least `minSize`, clamped to the frame. */
export function squareAround(
  box: Roi,
  share: number,
  minSize: number,
  frameW: number,
  frameH: number,
): Roi {
  const side = Math.max(minSize, Math.max(box.width, box.height) * (1 + share));
  return clampSquare(box.x + box.width / 2, box.y + box.height / 2, side, frameW, frameH);
}

/** Bounding box of the landmarks at or above `minVisibility`, or null when there are too few. */
export function confidentBox(landmarks: readonly Landmark[], minVisibility: number): Roi | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let count = 0;
  for (const lm of landmarks) {
    if (!(lm.v >= minVisibility) || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
    x0 = Math.min(x0, lm.x);
    y0 = Math.min(y0, lm.y);
    x1 = Math.max(x1, lm.x);
    y1 = Math.max(y1, lm.y);
    count++;
  }
  if (count < 4) return null;
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/** Maps landmarks from normalised crop coordinates back to full-frame pixels. */
export function fromCrop(
  normalised: readonly { x: number; y: number; visibility: number }[],
  crop: Roi,
): Landmark[] {
  return normalised.map((p) => ({
    x: crop.x + p.x * crop.width,
    y: crop.y + p.y * crop.height,
    v: Math.max(0, Math.min(1, p.visibility)),
  }));
}

export type TrackerStep =
  | { kind: 'tracked' }
  | { kind: 'missed'; consecutive: number }
  | { kind: 'exited' }
  | { kind: 'lost'; fromFrame: number; toFrame: number }
  | { kind: 'never_found' };

/**
 * Follows the athlete from the coach's box. Each crop is a square around the previous frame's
 * confident landmarks. When a frame has no person, the caller retries once with `retryCrop()`.
 * After more than `maxConsecutiveMisses` misses the tracker reports `exited` when the athlete's
 * last box touched the side of the frame (the end of a normal pass), `lost` otherwise, and
 * `never_found` when the athlete was never detected.
 */
export class RoiTracker {
  private last: Roi | null = null;
  private lastTrackedFrame = -1;
  private misses = 0;
  private readonly initial: Roi;

  constructor(
    initialBox: Roi,
    private readonly frameW: number,
    private readonly frameH: number,
    private readonly config: AnalysisConfig,
  ) {
    this.initial = initialBox;
  }

  /** The crop to run the estimator on for the next frame. */
  crop(): Roi {
    const r = this.config.roi;
    return squareAround(
      this.last ?? this.initial,
      r.enlarge,
      r.minSizePx,
      this.frameW,
      this.frameH,
    );
  }

  /** The single retry after a miss: the coach's box enlarged by retryEnlarge. */
  retryCrop(): Roi {
    const r = this.config.roi;
    return squareAround(this.initial, r.retryEnlarge, r.minSizePx, this.frameW, this.frameH);
  }

  update(frame: number, landmarks: readonly Landmark[] | null): TrackerStep {
    const box = landmarks
      ? confidentBox(landmarks, this.config.landmarks.confidentVisibility)
      : null;
    if (box) {
      this.last = box;
      this.lastTrackedFrame = frame;
      this.misses = 0;
      return { kind: 'tracked' };
    }
    this.misses++;
    if (this.misses <= this.config.roi.maxConsecutiveMisses)
      return { kind: 'missed', consecutive: this.misses };
    if (!this.last) return { kind: 'never_found' };
    const margin = 0.02 * this.frameW;
    const atEdge = this.last.x <= margin || this.last.x + this.last.width >= this.frameW - margin;
    return atEdge
      ? { kind: 'exited' }
      : { kind: 'lost', fromFrame: this.lastTrackedFrame + 1, toFrame: frame };
  }
}
