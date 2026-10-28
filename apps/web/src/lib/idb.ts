import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// The app's IndexedDB database. Personal data lives here (never in the service worker cache):
// the persisted query cache, the outbox, and key-frame thumbnails. Sign-out clears it.

interface StrideDb extends DBSchema {
  outbox: { key: string; value: unknown };
  queryCache: { key: string; value: unknown };
  thumbnails: { key: string; value: Blob };
}

const NAME = 'stride';
const VERSION = 1;
let opening: Promise<IDBPDatabase<StrideDb>> | null = null;

export function strideDb(): Promise<IDBPDatabase<StrideDb>> {
  opening ??= openDB<StrideDb>(NAME, VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox');
      if (!db.objectStoreNames.contains('queryCache')) db.createObjectStore('queryCache');
      if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails');
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
