import { indexedDbAvailable, strideDb } from '../idb';

// Key-frame thumbnails: three small JPEGs per analysis (initial contact, mid-stance, toe-off),
// for the result viewer and reports. Kept in IndexedDB, or in memory without it.

export const KEY_FRAME_KINDS = ['ic', 'mid', 'to'] as const;
export type KeyFrameKind = (typeof KEY_FRAME_KINDS)[number];

const memory = new Map<string, Blob>();
const key = (analysisId: string, kind: KeyFrameKind) => `${analysisId}/${kind}`;

export async function putThumbnail(
  analysisId: string,
  kind: KeyFrameKind,
  jpeg: Blob,
): Promise<void> {
  if (!indexedDbAvailable()) {
    memory.set(key(analysisId, kind), jpeg);
    return;
  }
  await (await strideDb()).put('thumbnails', jpeg, key(analysisId, kind));
}

export async function getThumbnail(
  analysisId: string,
  kind: KeyFrameKind,
): Promise<Blob | undefined> {
  if (!indexedDbAvailable()) return memory.get(key(analysisId, kind));
  return (await strideDb()).get('thumbnails', key(analysisId, kind));
}

export async function deleteThumbnails(analysisId: string): Promise<void> {
  for (const kind of KEY_FRAME_KINDS) {
    if (!indexedDbAvailable()) memory.delete(key(analysisId, kind));
    else await (await strideDb()).delete('thumbnails', key(analysisId, kind));
  }
}

export async function deleteAllThumbnails(): Promise<void> {
  memory.clear();
  if (indexedDbAvailable()) await (await strideDb()).clear('thumbnails');
}
