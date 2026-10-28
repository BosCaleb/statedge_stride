import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { indexedDbAvailable, strideDb } from './idb';

// Persists the query cache (athletes, sessions, recent analyses) to IndexedDB, so that the app
// opens with its data offline. Only the query keys listed are kept; sign-out clears them all.

const KEY = 'client';

/** Query keys whose data is kept on the phone between visits. */
export const PERSISTED_QUERY_KEYS = [
  'me',
  'athletes',
  'athlete',
  'consents',
  'sessions',
  'session',
  'analysis',
  'history',
];

export function idbPersister(): Persister {
  if (!indexedDbAvailable()) {
    // No IndexedDB (some private modes, tests): the cache lives in memory only.
    return {
      persistClient: () => undefined,
      restoreClient: () => undefined,
      removeClient: () => undefined,
    };
  }
  return {
    async persistClient(client: PersistedClient) {
      const db = await strideDb();
      await db.put('queryCache', client, KEY);
    },
    async restoreClient() {
      const db = await strideDb();
      return (await db.get('queryCache', KEY)) as PersistedClient | undefined;
    },
    async removeClient() {
      const db = await strideDb();
      await db.delete('queryCache', KEY);
    },
  };
}
