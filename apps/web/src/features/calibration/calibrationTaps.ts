import type { Point } from '@stride/analysis/types';

// Placing the two calibration markers: the first tap places A, the second B; after that a tap
// moves whichever marker is selected. A marker can be dragged or nudged a pixel at a time, and
// stays inside the frame. Pure, so that the tap logic is tested without a canvas.

export type MarkerId = 'a' | 'b';

export interface TapState {
  a: Point | null;
  b: Point | null;
  /** The marker the next tap, drag or nudge changes. */
  active: MarkerId;
}

export type TapAction =
  | { type: 'tap'; point: Point }
  | { type: 'move'; marker: MarkerId; point: Point }
  | { type: 'select'; marker: MarkerId }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'reset' };

export interface FrameSize {
  width: number;
  height: number;
}

export const initialTaps: TapState = { a: null, b: null, active: 'a' };

export function clampToFrame(p: Point, frame: FrameSize): Point {
  return {
    x: Math.min(frame.width - 1, Math.max(0, p.x)),
    y: Math.min(frame.height - 1, Math.max(0, p.y)),
  };
}

export function tapReducer(state: TapState, action: TapAction, frame: FrameSize): TapState {
  switch (action.type) {
    case 'tap': {
      const point = clampToFrame(action.point, frame);
      const placed = { ...state, [state.active]: point };
      // After A is first placed, the next tap places B.
      return state.active === 'a' && state.b === null ? { ...placed, active: 'b' } : placed;
    }
    case 'move':
      return {
        ...state,
        [action.marker]: clampToFrame(action.point, frame),
        active: action.marker,
      };
    case 'select':
      return { ...state, active: action.marker };
    case 'nudge': {
      const current = state[state.active];
      if (!current) return state;
      return {
        ...state,
        [state.active]: clampToFrame({ x: current.x + action.dx, y: current.y + action.dy }, frame),
      };
    }
    case 'reset':
      return initialTaps;
  }
}

/** The marker within `radius` frame pixels of a point, nearest first. */
export function markerAt(state: TapState, p: Point, radius: number): MarkerId | null {
  let best: MarkerId | null = null;
  let bestDistance = radius;
  for (const id of ['a', 'b'] as const) {
    const m = state[id];
    if (!m) continue;
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d <= bestDistance) {
      best = id;
      bestDistance = d;
    }
  }
  return best;
}
