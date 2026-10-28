import type { RouteName } from '@stride/shared/api/routes';
import { z } from 'zod';
import { ApiProblem, NetworkError, PERMANENT_CODES } from '../api';

// Every write to the API goes through the outbox, online or not. Entries flush in creation order,
// each waiting for the entries it depends on (an analysis needs its athlete, session and clip).
// Creates are idempotent PUTs with client-generated ids, so a repeat after a lost response is
// safe. Permanent errors stop an entry until the coach retries or discards it; a 401 pauses the
// queue until sign-in; network errors and 5xx retry with backoff (1 s doubling to 60 s, jitter).

export const outboxEntrySchema = z.object({
  /** Also the idempotency key: a create PUT uses the resource id the client generated. */
  id: z.string(),
  createdAt: z.number(),
  route: z.string(),
  params: z.record(z.string(), z.string()).optional(),
  /** JSON, or a Blob for keypoint files and key-frame images. */
  body: z.unknown().optional(),
  dependsOn: z.array(z.string()),
  /** The resource this write creates or changes, so that later writes can depend on it. */
  resource: z.object({ type: z.string(), id: z.string() }).nullable(),
  /** What the coach sees in the outbox list, such as "Consent for L. Molefe". */
  label: z.string(),
  /** Query keys to refresh once the queue has emptied after this write. */
  invalidates: z.array(z.array(z.string())).optional(),
  state: z.enum(['pending', 'sending', 'failed']),
  attempts: z.number().int(),
  nextAttemptAt: z.number(),
  lastError: z.object({ code: z.string(), detail: z.string() }).nullable(),
});
export type OutboxEntry = Omit<z.infer<typeof outboxEntrySchema>, 'route'> & { route: RouteName };

export interface OutboxStorage {
  all(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export type Sender = (entry: OutboxEntry) => Promise<unknown>;

export interface EnqueueInput {
  id?: string;
  route: RouteName;
  params?: Record<string, string>;
  body?: unknown;
  resource?: { type: string; id: string } | null;
  /** Resources this write needs: any queued write of them must succeed first. */
  needs?: { type: string; id: string }[];
  label: string;
  invalidates?: string[][];
}

export interface OutboxOptions {
  now?: () => number;
  random?: () => number;
  /** Called after every change, with all entries. */
  onChange?: (entries: OutboxEntry[], status: { paused: boolean; sending: boolean }) => void;
  /** Called after a write succeeded, with the API's answer. */
  onSent?: (entry: OutboxEntry, result: unknown) => void;
  /** Called when the next retry is due, so the runtime can flush then. */
  schedule?: (atMs: number) => void;
}

const MAX_DELAY_MS = 60_000;

export function backoffMs(attempts: number, random: number): number {
  const base = Math.min(MAX_DELAY_MS, 1000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (1 + 0.2 * random));
}

export class Outbox {
  private flushing: Promise<void> | null = null;
  private paused = false;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(
    private readonly storage: OutboxStorage,
    private readonly send: Sender,
    private readonly options: OutboxOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  async list(): Promise<OutboxEntry[]> {
    return (await this.storage.all()).sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
  }

  async enqueue(input: EnqueueInput): Promise<OutboxEntry> {
    const entries = await this.list();
    const needs = input.needs ?? [];
    const dependsOn = entries
      .filter(
        (e) =>
          e.resource && needs.some((n) => n.type === e.resource?.type && n.id === e.resource.id),
      )
      .map((e) => e.id);
    const at = Math.max(this.now(), (entries.at(-1)?.createdAt ?? 0) + 1);
    const entry: OutboxEntry = {
      id: input.id ?? crypto.randomUUID(),
      createdAt: at,
      route: input.route,
      ...(input.params ? { params: input.params } : {}),
      ...(input.body === undefined ? {} : { body: input.body }),
      dependsOn,
      resource: input.resource ?? null,
      label: input.label,
      ...(input.invalidates ? { invalidates: input.invalidates } : {}),
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    };
    await this.storage.put(entry);
    await this.changed();
    return entry;
  }

  /** Sends what can be sent now. Concurrent calls share one run. */
  flush(): Promise<void> {
    this.flushing ??= this.run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /**
   * Sends now, without waiting out the backoff of entries that failed on the network: for when
   * the connection comes back and for "Sync now". Entries that failed for good stay failed.
   */
  async flushNow(): Promise<void> {
    for (const entry of await this.storage.all()) {
      if (entry.state === 'pending' && entry.nextAttemptAt > 0)
        await this.storage.put({ ...entry, nextAttemptAt: 0 });
    }
    return this.flush();
  }

  /** After the coach signs in again. */
  resume(): Promise<void> {
    this.paused = false;
    return this.flush();
  }

  async retry(id: string): Promise<void> {
    const entry = (await this.storage.all()).find((e) => e.id === id);
    if (!entry) return;
    await this.storage.put({ ...entry, state: 'pending', nextAttemptAt: 0, lastError: null });
    await this.changed();
    await this.flush();
  }

  async discard(id: string): Promise<void> {
    await this.storage.remove(id);
    await this.changed();
  }

  async clear(): Promise<void> {
    await this.storage.clear();
    await this.changed();
  }

  private async run(): Promise<void> {
    if (this.paused) return;
    for (;;) {
      const entries = await this.list();
      const ids = new Set(entries.map((e) => e.id));
      // The first pending entry whose dependencies have all been sent (and so removed).
      const next = entries.find(
        (e) => e.state !== 'failed' && e.dependsOn.every((d) => !ids.has(d)),
      );
      if (!next) return;
      if (next.nextAttemptAt > this.now()) {
        this.options.schedule?.(next.nextAttemptAt);
        return;
      }
      await this.storage.put({ ...next, state: 'sending' });
      await this.changed(true);
      try {
        const result = await this.send(next);
        await this.storage.remove(next.id);
        this.options.onSent?.(next, result);
        await this.changed();
      } catch (error) {
        const attempts = next.attempts + 1;
        if (error instanceof ApiProblem && error.code === 'unauthorised') {
          this.paused = true;
          await this.storage.put({ ...next, state: 'pending', attempts });
          await this.changed();
          return;
        }
        if (error instanceof ApiProblem && PERMANENT_CODES.includes(error.code)) {
          await this.storage.put({
            ...next,
            state: 'failed',
            attempts,
            lastError: { code: error.code, detail: error.problem.detail ?? error.problem.title },
          });
          await this.changed();
          continue;
        }
        // Network errors, 5xx and 429: wait, then try again in the same order.
        const code =
          error instanceof ApiProblem
            ? error.code
            : error instanceof NetworkError
              ? 'network'
              : 'unknown';
        const at = this.now() + backoffMs(attempts, this.random());
        await this.storage.put({
          ...next,
          state: 'pending',
          attempts,
          nextAttemptAt: at,
          lastError: { code, detail: error instanceof Error ? error.message : String(error) },
        });
        await this.changed();
        this.options.schedule?.(at);
        return;
      }
    }
  }

  private async changed(sending = false): Promise<void> {
    if (!this.options.onChange) return;
    this.options.onChange(await this.list(), { paused: this.paused, sending });
  }
}

/** An in-memory store, for tests and for browsers without IndexedDB. */
export function memoryStorage(): OutboxStorage {
  const map = new Map<string, OutboxEntry>();
  return {
    all: () => Promise.resolve([...map.values()].map((e) => ({ ...e }))),
    put: (e) => {
      map.set(e.id, { ...e });
      return Promise.resolve();
    },
    remove: (id) => {
      map.delete(id);
      return Promise.resolve();
    },
    clear: () => {
      map.clear();
      return Promise.resolve();
    },
  };
}
