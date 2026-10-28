import { z } from 'zod';
import { indexedDbAvailable, strideDb } from '../idb';
import type { CopyLocation, LocalClip } from './records';

// The local clip library: copies of imported run clips, so that a result can be played later
// even if the original was moved or deleted from the gallery. Copies go to the Origin Private
// File System at /clips/{clipId}, written with createWritable, or through a worker with a
// synchronous access handle where createWritable is missing. Without OPFS they go to IndexedDB
// as blobs, and if that fails too the coach picks the original again when it is needed.

const DIRECTORY = 'clips';
/** Warn the coach when the app's storage passes this share of the quota. */
export const STORAGE_WARN_SHARE = 0.8;

const writerReply = z.object({ ok: z.boolean(), error: z.string().optional() });

function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function clipsDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!opfsAvailable()) return null;
  const root = await navigator.storage.getDirectory();
  try {
    return await root.getDirectoryHandle(DIRECTORY, { create });
  } catch {
    return null; // Not created yet.
  }
}

function writeInWorker(name: string, file: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./opfsWriter.worker.ts', import.meta.url), {
        type: 'module',
        name: 'stride-clip-writer',
      });
    } catch {
      resolve(false);
      return;
    }
    const finish = (ok: boolean) => {
      worker.terminate();
      resolve(ok);
    };
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const reply = writerReply.safeParse(event.data);
      finish(reply.success && reply.data.ok);
    });
    worker.addEventListener('error', () => finish(false));
    worker.postMessage({ directory: DIRECTORY, name, file });
  });
}

async function writeOpfs(name: string, file: Blob): Promise<boolean> {
  const dir = await clipsDirectory(true);
  if (!dir) return false;
  const handle = await dir.getFileHandle(name, { create: true });
  try {
    if (typeof handle.createWritable === 'function') {
      const writable = await handle.createWritable();
      await file.stream().pipeTo(writable);
      return true;
    }
    if (await writeInWorker(name, file)) return true;
  } catch {
    // Quota or a failed write: fall through and remove the partial file.
  }
  await dir.removeEntry(name).catch(() => undefined);
  return false;
}

/** Keeps a copy of the clip. Returns where it went. */
export async function keepCopy(clipId: string, file: Blob): Promise<CopyLocation> {
  try {
    if (await writeOpfs(clipId, file)) return 'opfs';
  } catch {
    // OPFS refused (private mode, quota): try IndexedDB.
  }
  if (!indexedDbAvailable()) return 'none';
  try {
    await (await strideDb()).put('clipBlobs', file, clipId);
    return 'idb';
  } catch {
    return 'none';
  }
}

/** The kept copy of a clip, or null when there is none (or it has gone). */
export async function readCopy(clip: Pick<LocalClip, 'id' | 'copy'>): Promise<Blob | null> {
  try {
    if (clip.copy === 'opfs') {
      const dir = await clipsDirectory(false);
      if (!dir) return null;
      return await (await dir.getFileHandle(clip.id)).getFile();
    }
    if (clip.copy === 'idb' && indexedDbAvailable()) {
      return (await (await strideDb()).get('clipBlobs', clip.id)) ?? null;
    }
  } catch {
    // Removed by the browser or by the coach.
  }
  return null;
}

/** Removes the copy of a clip wherever it is. */
export async function deleteCopy(clipId: string): Promise<void> {
  const dir = await clipsDirectory(false).catch(() => null);
  await dir?.removeEntry(clipId).catch(() => undefined);
  if (indexedDbAvailable()) await (await strideDb()).delete('clipBlobs', clipId);
}

/** Removes every copy (sign-out on a shared phone). */
export async function deleteAllCopies(): Promise<void> {
  if (opfsAvailable()) {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DIRECTORY, { recursive: true }).catch(() => undefined);
  }
  if (indexedDbAvailable()) await (await strideDb()).clear('clipBlobs');
}

export interface StorageUse {
  usage: number;
  quota: number;
  /** True at or above STORAGE_WARN_SHARE of the quota. */
  nearlyFull: boolean;
}

export async function storageUse(): Promise<StorageUse | null> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function')
    return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!(quota > 0)) return null;
    return { usage, quota, nearlyFull: usage / quota >= STORAGE_WARN_SHARE };
  } catch {
    return null;
  }
}
