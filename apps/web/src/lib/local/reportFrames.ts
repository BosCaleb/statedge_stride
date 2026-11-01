import { LIMITS } from '@stride/shared/limits';
import { indexedDbAvailable, strideDb } from '../idb';

// A report's key frames (JPEG, at most five), kept on this phone so that a share link can upload
// them later, from the report's screen. Kept in IndexedDB, or in memory without it.

const memory = new Map<string, Blob>();
const key = (reportId: string, ordinal: number) => `${reportId}/${ordinal}`;
const ORDINALS = Array.from({ length: LIMITS.maxReportFrames }, (_, i) => i + 1);

/** Replaces the report's frames with these, numbered from 1 in order. */
export async function putReportFrames(reportId: string, frames: readonly Blob[]): Promise<void> {
  await deleteReportFrames(reportId);
  for (const [i, jpeg] of frames.entries()) {
    if (!indexedDbAvailable()) memory.set(key(reportId, i + 1), jpeg);
    else await (await strideDb()).put('reportFrames', jpeg, key(reportId, i + 1));
  }
}

/** The report's frames by ordinal, for those kept on this phone. */
export async function getReportFrames(reportId: string): Promise<Map<number, Blob>> {
  const found = new Map<number, Blob>();
  for (const ordinal of ORDINALS) {
    const jpeg = indexedDbAvailable()
      ? await (await strideDb()).get('reportFrames', key(reportId, ordinal))
      : memory.get(key(reportId, ordinal));
    if (jpeg) found.set(ordinal, jpeg);
  }
  return found;
}

export async function deleteReportFrames(reportId: string): Promise<void> {
  for (const ordinal of ORDINALS) {
    if (!indexedDbAvailable()) memory.delete(key(reportId, ordinal));
    else await (await strideDb()).delete('reportFrames', key(reportId, ordinal));
  }
}

export async function deleteAllReportFrames(): Promise<void> {
  memory.clear();
  if (indexedDbAvailable()) await (await strideDb()).clear('reportFrames');
}
