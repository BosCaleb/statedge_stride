import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../apiContext';
import { useAuth } from '../auth/authContext';
import { onSignOut } from '../auth/signOutCleanup';
import { indexedDbAvailable } from '../idb';
import { idbOutboxStorage } from './idbStorage';
import { memoryStorage, Outbox, type OutboxEntry } from './outbox';
import { useOutboxStore } from './outboxStore';

// Runs the outbox for the signed-in coach: flushes on start, when the browser comes online, when
// the app becomes visible, after each enqueue and on "Sync now". iOS has no background sync, so
// syncing happens only while the app is open.

const OutboxContext = createContext<Outbox | null>(null);

export function useOutbox(): Outbox {
  const outbox = useContext(OutboxContext);
  if (!outbox) throw new Error('useOutbox needs an OutboxProvider');
  return outbox;
}

/** The entries waiting or failed, for the outbox panel. */
export function useOutboxEntries(): OutboxEntry[] {
  return useOutboxStore((s) => s.entries);
}

export function OutboxProvider({ children }: { children: ReactNode }) {
  const call = useApi();
  const queryClient = useQueryClient();
  const auth = useAuth();
  // The API client changes when the coach signs in (it carries the token source), while the
  // outbox lives for the whole session: always send with the current client.
  const callRef = useRef(call);
  callRef.current = call;
  const [outbox] = useState(() => {
    const pendingInvalidations = new Map<string, string[]>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const box: Outbox = new Outbox(
      indexedDbAvailable() ? idbOutboxStorage() : memoryStorage(),
      async (entry) => {
        const input = { params: entry.params, body: entry.body } as never;
        return (await callRef.current(entry.route, input)).data;
      },
      {
        onChange(entries, status) {
          const waiting = entries.filter((e) => e.state !== 'failed');
          useOutboxStore.getState().set({
            entries,
            pending: waiting.length,
            failed: entries.length - waiting.length,
            sending: status.sending,
            paused: status.paused,
          });
          // Refresh from the server only once nothing is waiting, so that a refetch never
          // overwrites the optimistic state of writes still queued.
          if (waiting.length === 0 && pendingInvalidations.size > 0) {
            for (const key of pendingInvalidations.values())
              void queryClient.invalidateQueries({ queryKey: key });
            pendingInvalidations.clear();
          }
        },
        onSent(entry) {
          for (const key of entry.invalidates ?? [])
            pendingInvalidations.set(JSON.stringify(key), key);
        },
        schedule(atMs) {
          clearTimeout(timer);
          timer = setTimeout(() => void box.flush(), Math.max(0, atMs - Date.now()));
        },
      },
    );
    return box;
  });

  useEffect(() => {
    if (auth.status === 'signedIn') void outbox.resume();
  }, [auth.status, outbox]);

  useEffect(() => {
    const flush = () => void outbox.flush();
    const online = () => {
      useOutboxStore.getState().set({ online: true });
      flush();
    };
    const offline = () => useOutboxStore.getState().set({ online: false });
    const visible = () => {
      if (document.visibilityState === 'visible') flush();
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    const stop = onSignOut(() => outbox.clear());
    void outbox.list().then(() => outbox.flush());
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
      stop();
    };
  }, [outbox]);

  return <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>;
}
