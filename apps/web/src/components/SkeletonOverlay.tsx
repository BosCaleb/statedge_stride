import type { DecodedKeypoints } from '@stride/analysis/skp1';
import { useEffect, useRef } from 'react';
import { paintSkeleton } from './FrameCanvas';
import styles from './player.module.css';

/** The skeleton of one frame, drawn over whatever fills the parent (a frame or a video). */
export function SkeletonOverlay({
  keypoints,
  frame,
}: {
  keypoints: DecodedKeypoints;
  frame: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const parent = c?.parentElement;
    if (!c || !parent) return;
    const paint = () => paintSkeleton(c, keypoints, frame, parent.clientWidth, parent.clientHeight);
    paint();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(paint);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [keypoints, frame]);
  return <canvas ref={canvas} className={styles.overlay} aria-hidden="true" />;
}
