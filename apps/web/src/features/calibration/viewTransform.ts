import type { Point } from '@stride/analysis/types';
import type { FrameSize } from './calibrationTaps';

// Zoom and pan over a frame shown in a view (a canvas). `fit` is view pixels per frame pixel
// with the whole frame shown; `zoom` multiplies it. (x, y) is the frame pixel at the view's
// top-left corner. Pure, so that pinch zoom and taps map exactly to frame pixels in tests.

export interface View {
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const wholeFrame: View = { zoom: 1, x: 0, y: 0 };

export function viewToFrame(p: Point, view: View, fit: number): Point {
  const scale = fit * view.zoom;
  return { x: view.x + p.x / scale, y: view.y + p.y / scale };
}

export function frameToView(p: Point, view: View, fit: number): Point {
  const scale = fit * view.zoom;
  return { x: (p.x - view.x) * scale, y: (p.y - view.y) * scale };
}

/** Keeps the zoom within limits and the view inside the frame. */
export function clampView(view: View, fit: number, frame: FrameSize): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  const scale = fit * zoom;
  // The view shows frame.width * fit view pixels across at zoom 1.
  const visibleW = (frame.width * fit) / scale;
  const visibleH = (frame.height * fit) / scale;
  return {
    zoom,
    x: Math.min(Math.max(0, frame.width - visibleW), Math.max(0, view.x)),
    y: Math.min(Math.max(0, frame.height - visibleH), Math.max(0, view.y)),
  };
}

/** Zooms by `factor` about a point of the view, which stays over the same frame pixel. */
export function zoomAt(
  view: View,
  focus: Point,
  factor: number,
  fit: number,
  frame: FrameSize,
): View {
  const anchor = viewToFrame(focus, view, fit);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const scale = fit * zoom;
  return clampView(
    { zoom, x: anchor.x - focus.x / scale, y: anchor.y - focus.y / scale },
    fit,
    frame,
  );
}

/** Moves the view with a finger: the frame follows by `dx`, `dy` view pixels. */
export function panBy(view: View, dx: number, dy: number, fit: number, frame: FrameSize): View {
  const scale = fit * view.zoom;
  return clampView({ ...view, x: view.x - dx / scale, y: view.y - dy / scale }, fit, frame);
}
