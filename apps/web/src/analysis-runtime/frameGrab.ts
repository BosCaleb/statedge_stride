// Still frames from a clip for the screens around the analysis (the calibration frame, the
// athlete box, key frames) using a hidden video element, and JPEG encoding for keeping them.
// The analysis itself decodes frames in the worker (decoder.ts); this is only for single frames.

export interface FrameSize {
  width: number;
  height: number;
}

/** Key-frame and calibration images: width, JPEG quality and the size cap (spec, reports). */
export const FRAME_JPEG = { maxWidth: 1280, quality: 0.8, maxBytes: 300 * 1024 } as const;

export class FrameGrabber {
  private readonly video: HTMLVideoElement;
  private readonly url: string;
  private readonly ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: Blob) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.url = URL.createObjectURL(file);
    this.ready = new Promise<void>((resolve, reject) => {
      this.video.addEventListener('loadeddata', () => resolve(), { once: true });
      this.video.addEventListener('error', () => reject(new Error('video could not be loaded')), {
        once: true,
      });
    });
    this.video.src = this.url;
  }

  /** Seconds, as the video element counts them (from the first frame). */
  async duration(): Promise<number> {
    await this.ready;
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  /** The frame shown at `timeSec`, scaled to `size` when given. Grabs run one at a time. */
  grab(timeSec: number, size?: FrameSize): Promise<ImageBitmap> {
    const run = this.queue.then(async () => {
      await this.ready;
      const end = Number.isFinite(this.video.duration) ? this.video.duration : timeSec;
      const t = Math.min(Math.max(0, timeSec), Math.max(0, end - 0.001));
      if (Math.abs(this.video.currentTime - t) > 1e-6 || this.video.readyState < 2) {
        const seeked = new Promise<void>((resolve, reject) => {
          this.video.addEventListener('seeked', () => resolve(), { once: true });
          this.video.addEventListener('error', () => reject(new Error('seek failed')), {
            once: true,
          });
        });
        this.video.currentTime = t;
        await seeked;
      }
      return size
        ? createImageBitmap(this.video, {
            resizeWidth: size.width,
            resizeHeight: size.height,
            resizeQuality: 'high',
          })
        : createImageBitmap(this.video);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    URL.revokeObjectURL(this.url);
    this.video.removeAttribute('src');
    this.video.load();
  }
}

/** A 2D canvas of the given size: OffscreenCanvas where available. */
export function canvas2d(
  width: number,
  height: number,
): {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  toBlob: (type: string, quality: number) => Promise<Blob>;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    return { ctx, toBlob: (type, quality) => c.convertToBlob({ type, quality }) };
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return {
    ctx,
    toBlob: (type, quality) =>
      new Promise((resolve, reject) =>
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality),
      ),
  };
}

/**
 * Draws a frame (and anything `decorate` adds) at up to 1280 px wide and encodes it as JPEG at
 * quality 0.8, lowering the quality until it is under 300 KB.
 */
export async function frameJpeg(
  source: CanvasImageSource,
  size: FrameSize,
  decorate?: (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    scale: number,
  ) => void,
): Promise<Blob> {
  const scale = Math.min(1, FRAME_JPEG.maxWidth / size.width);
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  const { ctx, toBlob } = canvas2d(width, height);
  ctx.drawImage(source, 0, 0, width, height);
  decorate?.(ctx, scale);
  let quality: number = FRAME_JPEG.quality;
  let blob = await toBlob('image/jpeg', quality);
  while (blob.size > FRAME_JPEG.maxBytes && quality > 0.35) {
    quality -= 0.1;
    blob = await toBlob('image/jpeg', quality);
  }
  return blob;
}
