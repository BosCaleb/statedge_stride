import { useEffect, useRef, useState } from 'react';
import { FrameGrabber, type FrameSize } from '../analysis-runtime/frameGrab';

/**
 * The frame of `file` shown at `timeSec` (video time, from the first frame), as a bitmap of
 * `size`. While a frame is being fetched, later requests replace earlier ones, so scrubbing
 * does not queue up a seek for every position passed.
 */
export function useFrameAt(
  file: Blob | null,
  timeSec: number | null,
  size: FrameSize,
): ImageBitmap | null {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const grabber = useRef<FrameGrabber | null>(null);
  const shown = useRef<ImageBitmap | null>(null);
  const busy = useRef(false);
  const wanted = useRef<number | null>(null);
  const { width, height } = size;

  useEffect(() => {
    if (!file) return;
    const g = new FrameGrabber(file);
    grabber.current = g;
    return () => {
      g.dispose();
      if (grabber.current === g) grabber.current = null;
    };
  }, [file]);

  useEffect(() => {
    wanted.current = timeSec;
    const pump = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        while (wanted.current !== null && grabber.current) {
          const t = wanted.current;
          const g = grabber.current;
          const next = await g.grab(t, { width, height }).catch(() => null);
          if (grabber.current !== g) {
            next?.close();
            break;
          }
          if (next) {
            shown.current?.close();
            shown.current = next;
            setBitmap(next);
          }
          if (wanted.current === t) wanted.current = null;
        }
      } finally {
        busy.current = false;
      }
    };
    void pump();
  }, [file, timeSec, width, height]);

  useEffect(
    () => () => {
      shown.current?.close();
      shown.current = null;
    },
    [],
  );
  return bitmap;
}
