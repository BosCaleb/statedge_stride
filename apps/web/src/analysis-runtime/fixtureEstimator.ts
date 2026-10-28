import { decodeSkp1 } from '@stride/analysis/skp1';
import type { Landmark } from '@stride/analysis/types';
import type { PoseEstimator } from './poseEstimator';

/**
 * Test builds only (VITE_E2E=true): returns recorded landmarks from an SKP1 file by frame
 * index, so that end-to-end tests run the real decoder, worker and analysis with no model.
 * Production builds never import this module.
 */
export class FixturePoseEstimator implements PoseEstimator {
  readonly id = 'fixture';
  readonly version = '1';
  private frames: (Landmark[] | null)[] = [];

  constructor(private readonly url: string) {}

  async init(signal?: AbortSignal): Promise<void> {
    const response = await fetch(this.url, signal ? { signal } : {});
    if (!response.ok) throw new Error(`fixture ${this.url}: ${response.status}`);
    let bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const decoded = decodeSkp1(bytes);
    if (!decoded.ok) throw new Error(`fixture ${this.url}: ${decoded.reason}`);
    this.frames = decoded.value.frames;
  }

  estimate(
    _frame: ImageBitmap,
    _roi: unknown,
    meta?: { index: number },
  ): Promise<Landmark[] | null> {
    return Promise.resolve(this.frames[meta?.index ?? 0] ?? null);
  }

  dispose(): void {
    this.frames = [];
  }
}
