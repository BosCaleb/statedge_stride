import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// The app's IndexedDB database. Personal data lives here (never in the service worker cache):
// the persisted query cache, the outbox, key-frame thumbnails, report frames, and the records of
// the analysis loop (imported clips, calibrations and results not yet saved). Sign-out clears it.

interface StrideDb extends DBSchema {
  outbox: { key: string; value: unknown };
  queryCache: { key: string; value: unknown };
  thumbnails: { key: string; value: Blob };
  /** A report's key frames (JPEG), kept until a share link uploads them. */
  reportFrames: { key: string; value: Blob };
  /** Imported clips: container facts, fingerprint and where the copy of the video is. */
  clips: { key: string; value: unknown };
  /** Copies of clips, where the Origin Private File System is not available. */
  clipBlobs: { key: string; value: Blob };
  calibrations: { key: string; value: unknown };
  /** Finished analyses, with their keypoints, until they are saved. */
  results: { key: string; value: unknown };
}

export type StoreName =
  'clips' | 'clipBlobs' | 'calibrations' | 'results' | 'thumbnails' | 'reportFrames';

const NAME = 'stride';
const VERSION = 3;
let opening: Promise<IDBPDatabase<StrideDb>> | null = null;

export function strideDb(): Promise<IDBPDatabase<StrideDb>> {
  opening ??= openDB<StrideDb>(NAME, VERSION, {
    upgrade(db) {
      for (const name of [
        'outbox',
        'queryCache',
        'thumbnails',
        'reportFrames',
        'clips',
        'clipBlobs',
        'calibrations',
        'results',
      ] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    },
    blocking() {
      // Another tab is upgrading the database: let it, and reopen on next use.
      void opening?.then((db) => db.close());
      opening = null;
    },
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
