import { strideDb } from '../idb';
import { outboxEntrySchema, type OutboxEntry, type OutboxStorage } from './outbox';

/** The outbox in IndexedDB. Entries are parsed on every read: storage is a boundary too. */
export function idbOutboxStorage(): OutboxStorage {
  return {
    async all() {
      const db = await strideDb();
      const values = await db.getAll('outbox');
      return values.flatMap((v) => {
        const parsed = outboxEntrySchema.safeParse(v);
        return parsed.success ? [parsed.data as OutboxEntry] : [];
      });
    },
    async put(entry) {
      const db = await strideDb();
      await db.put('outbox', entry, entry.id);
    },
    async remove(id) {
      const db = await strideDb();
      await db.delete('outbox', id);
    },
    async clear() {
      const db = await strideDb();
      await db.clear('outbox');
    },
  };
}
