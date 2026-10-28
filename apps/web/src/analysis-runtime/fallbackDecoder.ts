import { nearestIndex, type DecodedFrame, type FrameSource, type SourceOptions } from './decoder';
import type { ClipProbe } from './probe';

// Stage 1, fallback path for codecs WebCodecs cannot decode on a given phone (for example HEVC):
// play the file in a <video> at a reduced playbackRate and read frames with
// requestVideoFrameCallback, de-duplicating on mediaTime. Needs the DOM, so it runs on the main
// thread and the frames are transferred to the analysis worker.

/** Frames waiting for the consumer before playback is paused. */
const MAX_QUEUED = 4;
/** Assumed display refresh; presentation above it drops frames. Verified in the spike. */
const DISPLAY_HZ = 60;

export function fallbackPlaybackRate(containerFps: number): number {
  if (!(containerFps > 0)) return 0.25;
  return Math.min(1, (0.8 * DISPLAY_HZ) / containerFps);
}

export function videoElementSource(
  file: Blob,
  probe: ClipProbe,
  options: SourceOptions,
): FrameSource {
  let dropped = 0;
  return {
    kind: 'video-element',
    get droppedFrames() {
      return dropped;
    },
    async *frames(signal: AbortSignal): AsyncGenerator<DecodedFrame> {
      const times = probe.containerTimesSec;
      const first = times[0] ?? 0;
      const interval = ((times[times.length - 1] ?? 0) - first) / Math.max(1, times.length - 1);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      const url = URL.createObjectURL(file);
      video.src = url;

      const queue: DecodedFrame[] = [];
      const seen = new Set<number>();
      let ended = false;
      let converting = 0;
      let failure: Error | null = null;
      let wake: (() => void) | null = null;
      const notify = () => {
        const w = wake;
        wake = null;
        w?.();
      };
      let lastMedia = -Infinity;
      let offset: number | null = null;

      const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (ended || signal.aborted) return;
        const media = meta.mediaTime;
        if (!seen.has(media)) {
          seen.add(media);
          if (Number.isFinite(lastMedia) && media - lastMedia > 1.5 * interval) dropped++;
          lastMedia = media;
          // Align the media timeline with the container timestamps on the first frame.
          offset ??= first - media;
          const index = nearestIndex(times, media + offset);
          if (index >= options.startFrame && index % options.frameStep === 0) {
            const timeSec = times[index] ?? media;
            converting++;
            // The video element already applies the container rotation.
            createImageBitmap(video)
              .then((bitmap) => {
                queue.push({ index, timeSec, bitmap });
                if (queue.length >= MAX_QUEUED) video.pause();
              })
              .catch((e: unknown) => {
                failure = e instanceof Error ? e : new Error(String(e));
              })
              .finally(() => {
                converting--;
                notify();
              });
          }
        }
        video.requestVideoFrameCallback(onFrame);
      };

      video.addEventListener('ended', () => {
        ended = true;
        notify();
      });
      video.addEventListener('error', () => {
        failure = new Error('video element could not decode the clip');
        notify();
      });
      try {
        await new Promise<void>((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => resolve(), { once: true });
          video.addEventListener('error', () => reject(new Error('cannot load clip')), {
            once: true,
          });
        });
        video.playbackRate = fallbackPlaybackRate(interval > 0 ? 1 / interval : 0);
        video.requestVideoFrameCallback(onFrame);
        await video.play();
        for (;;) {
          if (failure) throw failure as Error;
          if (signal.aborted) return;
          const next = queue.shift();
          if (next) {
            if (queue.length < MAX_QUEUED && video.paused && !ended) void video.play();
            yield next;
            continue;
          }
          if (ended && converting === 0) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        video.pause();
        for (const f of queue) f.bitmap.close();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
    },
  };
}
