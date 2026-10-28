import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';
import { CalibrationOverlay } from './CalibrationOverlay';
import {
  initialTaps,
  markerAt,
  tapReducer,
  type TapAction,
  type TapState,
} from './calibrationTaps';
import { clampView, frameToView, panBy, viewToFrame, zoomAt } from './viewTransform';

const frame = { width: 1920, height: 1080 };
const run = (actions: TapAction[], start: TapState = initialTaps) =>
  actions.reduce((s, a) => tapReducer(s, a, frame), start);

describe('calibration taps', () => {
  it('places A, then B, then moves the selected marker', () => {
    const one = run([{ type: 'tap', point: { x: 100, y: 500 } }]);
    expect(one).toEqual({ a: { x: 100, y: 500 }, b: null, active: 'b' });
    const two = run([{ type: 'tap', point: { x: 1100, y: 510 } }], one);
    expect(two.b).toEqual({ x: 1100, y: 510 });
    const three = run([{ type: 'tap', point: { x: 1120, y: 512 } }], two);
    expect(three).toMatchObject({ a: { x: 100, y: 500 }, b: { x: 1120, y: 512 } });
    const four = run(
      [
        { type: 'select', marker: 'a' },
        { type: 'tap', point: { x: 90, y: 505 } },
      ],
      three,
    );
    expect(four).toMatchObject({ a: { x: 90, y: 505 }, b: { x: 1120, y: 512 }, active: 'a' });
  });

  it('keeps markers inside the frame, and nudges a pixel at a time', () => {
    const s = run([
      { type: 'tap', point: { x: -40, y: 2000 } },
      { type: 'select', marker: 'a' },
      { type: 'nudge', dx: -1, dy: 0 },
      { type: 'nudge', dx: 5, dy: -3 },
    ]);
    expect(s.a).toEqual({ x: 5, y: 1076 });
  });

  it('does nothing when nudging a marker that is not placed', () => {
    expect(run([{ type: 'nudge', dx: 1, dy: 1 }])).toEqual(initialTaps);
  });

  it('drags a marker and selects it', () => {
    const s = run([
      { type: 'tap', point: { x: 100, y: 500 } },
      { type: 'tap', point: { x: 1100, y: 510 } },
      { type: 'move', marker: 'a', point: { x: 130, y: 498 } },
    ]);
    expect(s).toMatchObject({ a: { x: 130, y: 498 }, active: 'a' });
  });

  it('picks up the nearest marker within reach', () => {
    const s = run([
      { type: 'tap', point: { x: 100, y: 500 } },
      { type: 'tap', point: { x: 130, y: 500 } },
    ]);
    expect(markerAt(s, { x: 112, y: 500 }, 20)).toBe('a');
    expect(markerAt(s, { x: 120, y: 500 }, 20)).toBe('b');
    expect(markerAt(s, { x: 400, y: 500 }, 20)).toBeNull();
  });
});

describe('zoom and pan', () => {
  const fit = 0.5; // a 960 px wide view of a 1920 px frame

  it('maps view pixels to frame pixels and back', () => {
    const view = { zoom: 2, x: 400, y: 200 };
    const p = viewToFrame({ x: 100, y: 50 }, view, fit);
    expect(p).toEqual({ x: 500, y: 250 });
    expect(frameToView(p, view, fit)).toEqual({ x: 100, y: 50 });
  });

  it('keeps the pixel under the fingers still while zooming', () => {
    const focus = { x: 300, y: 200 };
    const before = viewToFrame(focus, { zoom: 1, x: 0, y: 0 }, fit);
    const zoomed = zoomAt({ zoom: 1, x: 0, y: 0 }, focus, 3, fit, frame);
    expect(zoomed.zoom).toBe(3);
    const after = viewToFrame(focus, zoomed, fit);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('never zooms out past the whole frame or pans off its edges', () => {
    expect(zoomAt({ zoom: 1, x: 0, y: 0 }, { x: 10, y: 10 }, 0.2, fit, frame)).toEqual({
      zoom: 1,
      x: 0,
      y: 0,
    });
    expect(panBy({ zoom: 2, x: 0, y: 0 }, 500, 500, fit, frame)).toEqual({ zoom: 2, x: 0, y: 0 });
    expect(clampView({ zoom: 2, x: 5000, y: 5000 }, fit, frame)).toEqual({
      zoom: 2,
      x: 960,
      y: 540,
    });
    expect(clampView({ zoom: 50, x: 0, y: 0 }, fit, frame).zoom).toBe(8);
  });
});

function Harness() {
  const [taps, dispatch] = useReducer(
    (s: TapState, a: TapAction) => tapReducer(s, a, frame),
    initialTaps,
  );
  return <CalibrationOverlay image={null} frame={frame} taps={taps} onAction={dispatch} />;
}

describe('CalibrationOverlay', () => {
  const tap = (canvas: HTMLElement, clientX: number, clientY: number) => {
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX, clientY });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX, clientY });
  };

  it('turns taps on the frame into marker positions in frame pixels', async () => {
    render(<Harness />);
    const canvas = screen.getByLabelText(/Calibration frame/);
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 }) as DOMRect;
    expect(screen.getByText(/Marker A: not placed/)).toBeInTheDocument();

    tap(canvas, 480, 270);
    expect(screen.getByText(/Marker A: 960, 540 px/)).toBeInTheDocument();
    tap(canvas, 720, 270);
    expect(screen.getByText(/Marker B: 1440, 540 px/)).toBeInTheDocument();

    // B is selected after it is placed; the arrows move it one pixel.
    expect(screen.getByRole('button', { name: 'Marker B' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move right' }));
    expect(screen.getByText(/Marker B: 1441, 540 px/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Marker A' }));
    canvas.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByText(/Marker A: 960, 539 px/)).toBeInTheDocument();
  });

  it('places B right next to A, as on a small screen', () => {
    render(<Harness />);
    const canvas = screen.getByLabelText(/Calibration frame/);
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 }) as DOMRect;
    tap(canvas, 100, 100);
    tap(canvas, 110, 100);
    expect(screen.getByText(/Marker A: 200, 200 px/)).toBeInTheDocument();
    expect(screen.getByText(/Marker B: 220, 200 px/)).toBeInTheDocument();
    // With both placed, a tap on the other marker selects it instead of moving the selected one.
    tap(canvas, 101, 100);
    expect(screen.getByRole('button', { name: 'Marker A' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/Marker B: 220, 200 px/)).toBeInTheDocument();
  });

  it('drags a placed marker instead of placing a new one', () => {
    render(<Harness />);
    const canvas = screen.getByLabelText(/Calibration frame/);
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 }) as DOMRect;
    tap(canvas, 100, 100);
    tap(canvas, 800, 100);
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 102, clientY: 101 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 150, clientY: 120 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 150, clientY: 120 });
    expect(screen.getByText(/Marker A: 300, 240 px/)).toBeInTheDocument();
    expect(screen.getByText(/Marker B: 1600, 200 px/)).toBeInTheDocument();
  });
});
