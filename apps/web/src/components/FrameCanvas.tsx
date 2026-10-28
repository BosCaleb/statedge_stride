import type { DecodedKeypoints } from '@stride/analysis/skp1';
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { nearestIndex } from '../analysis-runtime/decoder';
import { drawSkeleton, type SkeletonStyle } from '../features/results/skeleton';
import { strings } from '../lib/strings';
import { FrameScrubber } from './FrameScrubber';
import styles from './player.module.css';
import ui from './ui.module.css';

// The result viewer's player: the clip with the skeleton drawn over it, frame by frame. The
// video element plays at the chosen slow-motion speed; each presented frame's media time picks
// the landmarks to draw (requestVideoFrameCallback, or seeked and timeupdate where it is
// missing). Frame steps, the scrubber and the keyboard seek frame by frame.

export const SPEEDS = [0.125, 0.25, 0.5, 1] as const;
const UI_UPDATE_MS = 66;

export const SKELETON: SkeletonStyle = {
  left: '#F47820',
  right: '#1E4F8C',
  centre: '#ffffff',
  lineWidth: 3,
  minVisibility: 0.3,
};

export interface FrameCanvasHandle {
  /** Pauses and shows a frame (a zero-based index into the clip's frames). */
  seek(frame: number): void;
  /** Plays from the frame shown, at a slow-motion speed (for the comparison). */
  play(speed: number): void;
  pause(): void;
  /** The frame shown. */
  frame(): number;
}

/** Draws the skeleton of one frame over a box of the given CSS size. */
export function paintSkeleton(
  canvas: HTMLCanvasElement,
  keypoints: DecodedKeypoints,
  frame: number,
  cssWidth: number,
  cssHeight: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || cssWidth === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(cssWidth * dpr);
  const h = Math.round(cssHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const landmarks = keypoints.frames[frame];
  if (landmarks) drawSkeleton(ctx, landmarks, cssWidth / keypoints.header.widthPx, SKELETON);
}

export const FrameCanvas = forwardRef<
  FrameCanvasHandle,
  {
    file: Blob;
    keypoints: DecodedKeypoints;
    initialFrame: number;
    onFrame: (frame: number) => void;
    /** False when another component drives the player (the comparison). */
    controls?: boolean;
    /** Names the player when two are on one screen. */
    label?: string;
  }
>(function FrameCanvas(
  { file, keypoints, initialFrame, onFrame, controls = true, label = strings.results.playerLabel },
  ref,
) {
  const keysId = useId();
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(SPEEDS[0]);
  const [frame, setFrame] = useState(initialFrame);
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const times = keypoints.timesSec;
  const first = times[0] ?? 0;
  const count = keypoints.frames.length;
  const lastUi = useRef(0);
  const shown = useRef(-1);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const timeOf = useCallback(
    (index: number) => {
      const t = (times[index] ?? first) - first;
      const next = times[index + 1];
      const interval = next !== undefined ? next - (times[index] ?? 0) : 0;
      // A quarter of a frame in, so that rounding never shows the previous frame.
      return t + Math.max(0, interval) * 0.25;
    },
    [times, first],
  );

  const show = useCallback(
    (index: number, force = false) => {
      const v = video.current;
      const c = overlay.current;
      if (!v || !c) return;
      if (index !== shown.current || force) {
        shown.current = index;
        paintSkeleton(c, keypoints, index, v.clientWidth, v.clientHeight);
      }
      const now = performance.now();
      if (force || v.paused || now - lastUi.current > UI_UPDATE_MS) {
        lastUi.current = now;
        setFrame(index);
        onFrameRef.current(index);
      }
    },
    [keypoints],
  );

  const seek = useCallback(
    (index: number) => {
      const v = video.current;
      if (!v) return;
      const target = Math.min(count - 1, Math.max(0, index));
      v.pause();
      v.currentTime = timeOf(target);
      show(target, true);
    },
    [count, timeOf, show],
  );
  useImperativeHandle(
    ref,
    () => ({
      seek,
      play(rate: number) {
        const v = video.current;
        if (!v) return;
        setSpeed(rate);
        v.playbackRate = rate;
        void v.play().catch(() => setPlaying(false));
      },
      pause: () => video.current?.pause(),
      frame: () => Math.max(0, shown.current),
    }),
    [seek],
  );

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const fromMediaTime = (mediaTime: number) => nearestIndex(times, mediaTime + first);
    let handle = 0;
    const rvfc = typeof v.requestVideoFrameCallback === 'function';
    const onVideoFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      show(fromMediaTime(meta.mediaTime));
      handle = v.requestVideoFrameCallback(onVideoFrame);
    };
    const onTime = () => show(fromMediaTime(v.currentTime));
    if (rvfc) handle = v.requestVideoFrameCallback(onVideoFrame);
    v.addEventListener('seeked', onTime);
    if (!rvfc) v.addEventListener('timeupdate', onTime);
    const onResize = () => show(shown.current < 0 ? 0 : shown.current, true);
    window.addEventListener('resize', onResize);
    return () => {
      if (rvfc) v.cancelVideoFrameCallback(handle);
      v.removeEventListener('seeked', onTime);
      v.removeEventListener('timeupdate', onTime);
      window.removeEventListener('resize', onResize);
    };
  }, [times, first, show]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.ended || shown.current >= count - 1) v.currentTime = timeOf(0);
      v.playbackRate = speed;
      void v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') seek(frame + step);
    else if (e.key === 'ArrowLeft') seek(frame - step);
    else if (e.key === ' ' || e.key === 'k') toggle();
    else if (e.key === 'Home') seek(0);
    else if (e.key === 'End') seek(count - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className={styles.player}>
      <div
        className={styles.stage}
        style={{ aspectRatio: `${keypoints.header.widthPx} / ${keypoints.header.heightPx}` }}
        tabIndex={0}
        role="group"
        aria-label={label}
        aria-describedby={keysId}
        onKeyDown={onKey}
      >
        <video
          ref={video}
          className={styles.video}
          src={url}
          muted
          playsInline
          preload="auto"
          onLoadedData={() => seek(initialFrame)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <canvas ref={overlay} className={styles.overlay} aria-hidden="true" />
      </div>
      <p id={keysId} className="visuallyHidden">
        {strings.results.playerKeys}
      </p>
      {controls ? (
        <>
          <div className={styles.controls}>
            <button type="button" className={`${ui.button} ${ui.primary}`} onClick={toggle}>
              {playing ? strings.results.pause : strings.results.play}
            </button>
            <div className={styles.speeds} role="group" aria-label={strings.results.speedLabel}>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${ui.button} ${speed === s ? ui.secondary : ui.quiet}`}
                  aria-pressed={speed === s}
                  onClick={() => setSpeed(s)}
                >
                  {strings.results.speed(s)}
                </button>
              ))}
            </div>
          </div>
          <FrameScrubber
            index={frame}
            count={count}
            timeSec={(times[frame] ?? first) - first}
            onChange={seek}
          />
        </>
      ) : null}
    </div>
  );
});
