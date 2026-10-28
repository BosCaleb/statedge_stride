import type { Point } from '@stride/analysis/types';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import ui from '../../components/ui.module.css';
import { strings } from '../../lib/strings';
import {
  markerAt,
  type FrameSize,
  type MarkerId,
  type TapAction,
  type TapState,
} from './calibrationTaps';
import styles from './calibration.module.css';
import { frameToView, panBy, viewToFrame, wholeFrame, zoomAt, type View } from './viewTransform';

// Shows a frame and lets the coach place the two calibration markers: tap A then B, pinch or
// use the buttons to zoom, drag a marker to move it, or nudge it a pixel at a time. A loupe
// magnifies the spot under the finger, because taps in sunlight are not precise.

/** How far from a marker (view pixels) a touch still picks the marker up. */
const HIT_RADIUS = 28;
/** Movement (view pixels) that turns a press into a drag. */
const SLOP = 8;
const LOUPE_RADIUS = 56;
const LOUPE_MAGNIFICATION = 3;
const MAX_HEIGHT_SHARE = 0.7;

type Gesture =
  /** A finger down that becomes a tap, a drag of the marker under it, or a pan. */
  | { kind: 'press'; start: Point; hit: MarkerId | null }
  | { kind: 'drag'; marker: MarkerId }
  | { kind: 'pan'; last: Point }
  | { kind: 'pinch'; startDistance: number; startMid: Point; startView: View };

const MARKER_COLOURS: Record<MarkerId, string> = { a: '#F47820', b: '#1E4F8C' };

export function CalibrationOverlay({
  image,
  frame,
  taps,
  onAction,
}: {
  image: CanvasImageSource | null;
  frame: FrameSize;
  taps: TapState;
  onAction: (action: TapAction) => void;
}) {
  const positionsId = useId();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(wholeFrame);
  const [loupe, setLoupe] = useState<Point | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const fit = size.w > 0 ? size.w / frame.width : 1;

  // Fit the frame to the width, and to most of the screen height for portrait clips.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const width = el.getBoundingClientRect().width || frame.width;
      const maxH = window.innerHeight * MAX_HEIGHT_SHARE || frame.height;
      let w = width;
      let h = (w * frame.height) / frame.width;
      if (h > maxH) {
        h = maxH;
        w = (h * frame.width) / frame.height;
      }
      setSize({ w, h });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame.width, frame.height]);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const scale = fit * view.zoom;
    if (image)
      ctx.drawImage(image, view.x, view.y, size.w / scale, size.h / scale, 0, 0, size.w, size.h);

    const a = taps.a ? frameToView(taps.a, view, fit) : null;
    const b = taps.b ? frameToView(taps.b, view, fit) : null;
    if (a && b) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const [id, p] of [
      ['a', a],
      ['b', b],
    ] as const) {
      if (!p) continue;
      const active = taps.active === id;
      ctx.lineWidth = active ? 4 : 2;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = MARKER_COLOURS[id];
      ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 18, p.y);
      ctx.lineTo(p.x + 18, p.y);
      ctx.moveTo(p.x, p.y - 18);
      ctx.lineTo(p.x, p.y + 18);
      ctx.stroke();
      ctx.font = '600 16px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0d1c3e';
      ctx.lineWidth = 4;
      ctx.strokeText(id.toUpperCase(), p.x + 16, p.y - 16);
      ctx.fillText(id.toUpperCase(), p.x + 16, p.y - 16);
    }

    if (loupe && image) {
      const centre = { x: loupe.x, y: Math.max(LOUPE_RADIUS, loupe.y - LOUPE_RADIUS * 1.8) };
      const at = viewToFrame(loupe, view, fit);
      const loupeScale = scale * LOUPE_MAGNIFICATION;
      const half = LOUPE_RADIUS / loupeScale;
      ctx.save();
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, LOUPE_RADIUS, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        image,
        at.x - half,
        at.y - half,
        half * 2,
        half * 2,
        centre.x - LOUPE_RADIUS,
        centre.y - LOUPE_RADIUS,
        LOUPE_RADIUS * 2,
        LOUPE_RADIUS * 2,
      );
      ctx.restore();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, LOUPE_RADIUS, 0, Math.PI * 2);
      ctx.moveTo(centre.x - 10, centre.y);
      ctx.lineTo(centre.x + 10, centre.y);
      ctx.moveTo(centre.x, centre.y - 10);
      ctx.lineTo(centre.x, centre.y + 10);
      ctx.stroke();
    }
  }, [image, size, view, fit, taps, loupe]);

  const local = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = canvas.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return { x: 0, y: 0 };
      return {
        x: ((clientX - rect.left) * size.w) / rect.width,
        y: ((clientY - rect.top) * size.h) / rect.height,
      };
    },
    [size],
  );

  const pinchState = () => {
    const [p, q] = [...pointers.current.values()];
    if (!p || !q) return null;
    return {
      distance: Math.max(1, Math.hypot(q.x - p.x, q.y - p.y)),
      mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
    };
  };

  const zoomBy = (factor: number) =>
    setView((v) => zoomAt(v, { x: size.w / 2, y: size.h / 2 }, factor, fit, frame));

  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      onAction({ type: 'nudge', dx: move[0], dy: move[1] });
    } else if (e.key === 'a' || e.key === 'b') {
      onAction({ type: 'select', marker: e.key });
    } else if (e.key === '+' || e.key === '=') {
      zoomBy(1.5);
    } else if (e.key === '-') {
      zoomBy(1 / 1.5);
    }
  };

  const position = (id: MarkerId) => {
    const m = taps[id];
    const label = id === 'a' ? strings.calibration.markerA : strings.calibration.markerB;
    return m
      ? strings.calibration.position(label, Math.round(m.x), Math.round(m.y))
      : strings.calibration.notPlaced(label);
  };

  return (
    <div className={styles.overlay}>
      <div ref={box} className={styles.frameBox}>
        <canvas
          ref={canvas}
          className={styles.canvas}
          style={{ width: size.w || undefined, height: size.h || undefined }}
          tabIndex={0}
          aria-label={strings.calibration.canvasLabel}
          aria-describedby={positionsId}
          onKeyDown={onKey}
          onWheel={(e) => {
            const p = local(e.clientX, e.clientY);
            setView((v) => zoomAt(v, p, e.deltaY < 0 ? 1.25 : 0.8, fit, frame));
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            const p = local(e.clientX, e.clientY);
            pointers.current.set(e.pointerId, p);
            if (pointers.current.size === 2) {
              const pinch = pinchState();
              if (pinch)
                gesture.current = {
                  kind: 'pinch',
                  startDistance: pinch.distance,
                  startMid: pinch.mid,
                  startView: view,
                };
              setLoupe(null);
              return;
            }
            if (pointers.current.size > 2) return;
            const hit = markerAt(taps, viewToFrame(p, view, fit), HIT_RADIUS / (fit * view.zoom));
            gesture.current = { kind: 'press', start: p, hit };
            setLoupe(p);
          }}
          onPointerMove={(e) => {
            if (!pointers.current.has(e.pointerId)) return;
            const p = local(e.clientX, e.clientY);
            pointers.current.set(e.pointerId, p);
            const g = gesture.current;
            if (!g) return;
            if (g.kind === 'pinch') {
              const pinch = pinchState();
              if (!pinch) return;
              const zoomed = zoomAt(
                g.startView,
                g.startMid,
                pinch.distance / g.startDistance,
                fit,
                frame,
              );
              setView(
                panBy(zoomed, pinch.mid.x - g.startMid.x, pinch.mid.y - g.startMid.y, fit, frame),
              );
            } else if (g.kind === 'drag') {
              onAction({ type: 'move', marker: g.marker, point: viewToFrame(p, view, fit) });
              setLoupe(p);
            } else if (g.kind === 'press') {
              const moved = Math.hypot(p.x - g.start.x, p.y - g.start.y) > SLOP;
              if (moved && g.hit) {
                gesture.current = { kind: 'drag', marker: g.hit };
                onAction({ type: 'move', marker: g.hit, point: viewToFrame(p, view, fit) });
                setLoupe(p);
              } else if (moved && view.zoom > 1) {
                gesture.current = { kind: 'pan', last: p };
                setLoupe(null);
              } else {
                setLoupe(p);
              }
            } else {
              setView((v) => panBy(v, p.x - g.last.x, p.y - g.last.y, fit, frame));
              gesture.current = { kind: 'pan', last: p };
            }
          }}
          onPointerUp={(e) => {
            const p = local(e.clientX, e.clientY);
            const g = gesture.current;
            pointers.current.delete(e.pointerId);
            if (g?.kind === 'press') {
              // A tap on the other placed marker selects it; any other tap places or moves the
              // selected one (so B can be placed close to A on a small screen).
              if (g.hit && g.hit !== taps.active && taps.a && taps.b)
                onAction({ type: 'select', marker: g.hit });
              else onAction({ type: 'tap', point: viewToFrame(p, view, fit) });
            }
            if (g?.kind !== 'pinch' || pointers.current.size === 0) gesture.current = null;
            setLoupe(null);
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            gesture.current = null;
            setLoupe(null);
          }}
        />
      </div>

      <p id={positionsId} className={styles.positions} aria-live="polite">
        {position('a')} · {position('b')}
      </p>

      <div className={styles.controls}>
        <div className={styles.segment} role="group" aria-label={strings.calibration.adjustLabel}>
          {(['a', 'b'] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`${ui.button} ${taps.active === id ? ui.secondary : ui.quiet}`}
              aria-pressed={taps.active === id}
              onClick={() => onAction({ type: 'select', marker: id })}
            >
              {id === 'a' ? strings.calibration.markerA : strings.calibration.markerB}
            </button>
          ))}
        </div>
        <div className={styles.nudge} role="group" aria-label={strings.calibration.nudgeLabel}>
          {(
            [
              ['up', 0, -1, '↑'],
              ['left', -1, 0, '←'],
              ['right', 1, 0, '→'],
              ['down', 0, 1, '↓'],
            ] as const
          ).map(([dir, dx, dy, arrow]) => (
            <button
              key={dir}
              type="button"
              className={`${ui.button} ${ui.quiet}`}
              aria-label={strings.calibration.nudge[dir]}
              disabled={taps[taps.active] === null}
              onClick={() => onAction({ type: 'nudge', dx, dy })}
            >
              <span aria-hidden="true">{arrow}</span>
            </button>
          ))}
        </div>
        <div className={styles.segment} role="group" aria-label={strings.calibration.zoomLabel}>
          <button
            type="button"
            className={`${ui.button} ${ui.quiet}`}
            aria-label={strings.calibration.zoomOut}
            onClick={() => zoomBy(1 / 1.5)}
          >
            <span aria-hidden="true">−</span>
          </button>
          <button
            type="button"
            className={`${ui.button} ${ui.quiet}`}
            aria-label={strings.calibration.zoomIn}
            onClick={() => zoomBy(1.5)}
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            type="button"
            className={`${ui.button} ${ui.quiet}`}
            onClick={() => setView(wholeFrame)}
          >
            {strings.calibration.wholeFrame}
          </button>
        </div>
      </div>
    </div>
  );
}
