import { createFile, MP4BoxBuffer, type Sample } from 'mp4box';
import type { ClipProbe } from './probe';

// Stage 1, preferred path: demux with mp4box.js and decode with WebCodecs, in a worker. Frames
// are handed on as ImageBitmaps in presentation order and every VideoFrame is closed as soon as
// it has been converted, so memory stays flat however long the clip is.

export interface DecodedFrame {
  /** Index in presentation order (0-based). */
  index: number;
  /** Container presentation time in seconds. */
  timeSec: number;
  /** Display-oriented frame. The consumer must close it. */
  bitmap: ImageBitmap;
}

export interface FrameSource {
  readonly kind: 'webcodecs' | 'video-element';
  /** Frames on the analysis grid (index % frameStep === 0, index >= startFrame), in order. */
  frames(signal: AbortSignal): AsyncIterable<DecodedFrame>;
  /** Gaps larger than 1.5 times the median interval seen while decoding. */
  readonly droppedFrames: number;
}

export interface SourceOptions {
  startFrame: number;
  frameStep: number;
}

export function decoderConfig(probe: ClipProbe): VideoDecoderConfig {
  const config: VideoDecoderConfig = {
    codec: probe.codec,
    codedWidth: probe.codedWidth,
    codedHeight: probe.codedHeight,
    optimizeForLatency: false,
  };
  if (probe.description) config.description = probe.description;
  return config;
}

export async function webCodecsSupported(probe: ClipProbe): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined') return false;
  try {
    const support = await VideoDecoder.isConfigSupported(decoderConfig(probe));
    return support.supported === true;
  } catch {
    return false;
  }
}

/** Index of the timestamp nearest to `t` in a sorted array. */
export function nearestIndex(sorted: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((sorted[lo - 1] ?? 0) - t) <= Math.abs((sorted[lo] ?? 0) - t))
    return lo - 1;
  return lo;
}

/** Draws a frame upright according to the container rotation. */
export async function toUprightBitmap(
  frame: VideoFrame | ImageBitmap,
  rotation: ClipProbe['rotation'],
  codedWidth: number,
  codedHeight: number,
): Promise<ImageBitmap> {
  if (rotation === 0) return createImageBitmap(frame);
  const swap = rotation === 90 || rotation === 270;
  const canvas = new OffscreenCanvas(
    swap ? codedHeight : codedWidth,
    swap ? codedWidth : codedHeight,
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(frame, -codedWidth / 2, -codedHeight / 2, codedWidth, codedHeight);
  return canvas.transferToImageBitmap();
}

const READ_CHUNK_BYTES = 2 * 1024 * 1024;
/** Bound on decoded frames waiting for the consumer, plus chunks queued in the decoder. */
const MAX_IN_FLIGHT = 8;
/** Frames held back to restore presentation order if a decoder emits them out of order. */
const REORDER_DEPTH = 4;

/** A wake-up signal with an optional timeout, for producer and consumer hand-offs. */
class Signal {
  private waiters: (() => void)[] = [];
  notify() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
  wait(timeoutMs?: number): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      if (timeoutMs !== undefined) setTimeout(resolve, timeoutMs);
    });
  }
}

export function webCodecsSource(file: Blob, probe: ClipProbe, options: SourceOptions): FrameSource {
  let dropped = 0;
  return {
    kind: 'webcodecs',
    get droppedFrames() {
      return dropped;
    },
    async *frames(signal: AbortSignal): AsyncGenerator<DecodedFrame> {
      const times = probe.containerTimesSec;
      const interval =
        ((times[times.length - 1] ?? 0) - (times[0] ?? 0)) / Math.max(1, times.length - 1);
      const output: VideoFrame[] = [];
      const reorder: VideoFrame[] = [];
      const itemReady = new Signal();
      const spaceFree = new Signal();
      let failure: Error | null = null;
      let finished = false;
      const fail = (e: unknown) => {
        failure = e instanceof Error ? e : new Error(String(e));
        itemReady.notify();
        spaceFree.notify();
      };
      const decoder = new VideoDecoder({
        output: (frame) => {
          output.push(frame);
          itemReady.notify();
        },
        error: fail,
      });
      // A decoder that holds frames for reordering frees queue space without emitting output.
      decoder.addEventListener('dequeue', () => spaceFree.notify());
      decoder.configure(decoderConfig(probe));
      const inFlight = () => decoder.decodeQueueSize + output.length + reorder.length;

      const pending: Sample[] = [];
      const mp4 = createFile();
      mp4.onReady = () => {
        mp4.setExtractionOptions(probe.trackId, null, { nbSamples: 32 });
        mp4.start();
      };
      mp4.onSamples = (_id, _user, samples) => {
        for (const sample of samples) pending.push(sample);
      };

      // Producer: read the file, demux, and keep the decoder fed within the in-flight bound.
      const produce = async () => {
        let offset = 0;
        while (offset < file.size && !signal.aborted && failure === null) {
          const end = Math.min(file.size, offset + READ_CHUNK_BYTES);
          const buffer = MP4BoxBuffer.fromArrayBuffer(
            await file.slice(offset, end).arrayBuffer(),
            offset,
          );
          const next = mp4.appendBuffer(buffer, end >= file.size);
          offset = next > offset ? next : end;
          while (pending.length > 0 && !signal.aborted && failure === null) {
            while (inFlight() >= MAX_IN_FLIGHT && !signal.aborted && failure === null) {
              await spaceFree.wait(10);
            }
            const sample = pending.shift();
            if (!sample?.data) continue;
            decoder.decode(
              new EncodedVideoChunk({
                type: sample.is_sync ? 'key' : 'delta',
                timestamp: Math.round((1e6 * sample.cts) / sample.timescale),
                duration: Math.round((1e6 * sample.duration) / sample.timescale),
                data: sample.data,
              }),
            );
            mp4.releaseUsedSamples(probe.trackId, sample.number + 1);
          }
        }
        mp4.flush();
        if (!signal.aborted && failure === null && decoder.state === 'configured')
          await decoder.flush();
      };
      const producing = produce()
        .catch(fail)
        .finally(() => {
          finished = true;
          itemReady.notify();
        });

      let lastTime = -Infinity;
      try {
        for (;;) {
          if (failure) throw failure as Error;
          if (signal.aborted) return;
          const frame = output.shift();
          if (frame) {
            spaceFree.notify();
            reorder.push(frame);
            reorder.sort((a, b) => a.timestamp - b.timestamp);
            if (reorder.length <= REORDER_DEPTH && !finished) continue;
          } else if (!finished) {
            await itemReady.wait();
            continue;
          }
          const next = reorder.shift();
          if (!next) break;
          spaceFree.notify();
          const t = next.timestamp / 1e6;
          if (Number.isFinite(lastTime) && t - lastTime > 1.5 * interval) dropped++;
          lastTime = t;
          const index = nearestIndex(times, t);
          if (index < options.startFrame || index % options.frameStep !== 0) {
            next.close();
            continue;
          }
          const bitmap = await toUprightBitmap(
            next,
            probe.rotation,
            probe.codedWidth,
            probe.codedHeight,
          );
          next.close();
          yield { index, timeSec: times[index] ?? t, bitmap };
        }
      } finally {
        for (const f of reorder) f.close();
        for (const f of output) f.close();
        if (decoder.state !== 'closed') decoder.close();
        await producing;
      }
    },
  };
}
