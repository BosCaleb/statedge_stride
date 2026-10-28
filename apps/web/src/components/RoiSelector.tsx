import type { Point, Roi } from '@stride/analysis/types';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { strings } from '../lib/strings';
import { useFitSize } from '../lib/useFitSize';
import styles from './frames.module.css';

/** Smallest box side, in frame pixels. */
const MIN_SIDE = 16;

/** The box between two corners, inside the frame and at least MIN_SIDE on each side. */
export function boxFrom(a: Point, b: Point, frame: { width: number; height: number }): Roi {
  const clampX = (v: number) => Math.min(frame.width, Math.max(0, v));
  const clampY = (v: number) => Math.min(frame.height, Math.max(0, v));
  const x0 = clampX(Math.min(a.x, b.x));
  const y0 = clampY(Math.min(a.y, b.y));
  const x1 = clampX(Math.max(a.x, b.x));
  const y1 = clampY(Math.max(a.y, b.y));
  const width = Math.max(MIN_SIDE, x1 - x0);
  const height = Math.max(MIN_SIDE, y1 - y0);
  return {
    x: Math.min(x0, frame.width - width),
    y: Math.min(y0, frame.height - height),
    width,
    height,
  };
}

/**
 * Shows a frame of a run clip and lets the coach drag a box around the athlete. The box seeds
 * the region-of-interest tracking.
 */
export function RoiSelector({
  image,
  frame,
  roi,
  onChange,
}: {
  image: CanvasImageSource | null;
  frame: { width: number; height: number };
  roi: Roi | null;
  onChange: (roi: Roi) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useFitSize(box, frame);
  const start = useRef<Point | null>(null);
  const [draft, setDraft] = useState<Roi | null>(null);
  const shown = draft ?? roi;

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    if (image) ctx.drawImage(image, 0, 0, size.w, size.h);
    if (!shown) return;
    const s = size.w / frame.width;
    const r = { x: shown.x * s, y: shown.y * s, w: shown.width * s, h: shown.height * s };
    // Dim everything outside the box.
    ctx.fillStyle = 'rgb(13 28 62 / 45%)';
    ctx.beginPath();
    ctx.rect(0, 0, size.w, size.h);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill('evenodd');
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#F47820';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }, [image, size, frame.width, shown]);

  const toFrame = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * frame.width,
      y: ((e.clientY - rect.top) / rect.height) * frame.height,
    };
  };

  return (
    <div className={styles.scrubber}>
      <div ref={box} className={styles.frameBox}>
        <canvas
          ref={canvas}
          className={styles.canvas}
          style={{ width: size.w || undefined, height: size.h || undefined }}
          aria-label={strings.analyse.boxLabel}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            start.current = toFrame(e);
            setDraft(null);
          }}
          onPointerMove={(e) => {
            if (start.current) setDraft(boxFrom(start.current, toFrame(e), frame));
          }}
          onPointerUp={(e) => {
            if (start.current) onChange(boxFrom(start.current, toFrame(e), frame));
            start.current = null;
            setDraft(null);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDraft(null);
          }}
        />
      </div>
      <p className={styles.readout} aria-live="polite">
        {shown
          ? strings.analyse.boxReadout(
              Math.round(shown.width),
              Math.round(shown.height),
              Math.round(shown.x),
              Math.round(shown.y),
            )
          : strings.analyse.boxMissing}
      </p>
    </div>
  );
}
