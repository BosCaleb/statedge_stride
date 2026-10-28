import { RAD_TO_DEG } from './stats';
import type { Point } from './types';

// Angles in analysis coordinates: forward is +x and y points down. All results are degrees.

/**
 * Signed angle of the vector from `from` to `to` against the downward vertical. Positive when
 * `to` is ahead of `from` (forward). Used for the shin (knee to ankle) and the upper arm.
 */
export function angleFromDownVertical(from: Point, to: Point): number {
  return Math.atan2(to.x - from.x, to.y - from.y) * RAD_TO_DEG;
}

/**
 * Signed angle of the vector from `from` to `to` against the upward vertical. Positive when
 * `to` is ahead of `from`. Used for trunk lean (mid-hip to mid-shoulder).
 */
export function angleFromUpVertical(from: Point, to: Point): number {
  return Math.atan2(to.x - from.x, from.y - to.y) * RAD_TO_DEG;
}

/** Interior angle at `vertex` between the rays to `a` and `c`, from 0 to 180. */
export function interiorAngle(a: Point, vertex: Point, c: Point): number {
  const v1x = a.x - vertex.x;
  const v1y = a.y - vertex.y;
  const v2x = c.x - vertex.x;
  const v2y = c.y - vertex.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return NaN;
  const cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
  return Math.acos(Math.min(1, Math.max(-1, cos))) * RAD_TO_DEG;
}

/** Signed angle of the line from `from` to `to` against the horizontal. Positive when `to` is higher. */
export function angleFromHorizontal(from: Point, to: Point): number {
  return Math.atan2(from.y - to.y, to.x - from.x) * RAD_TO_DEG;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
