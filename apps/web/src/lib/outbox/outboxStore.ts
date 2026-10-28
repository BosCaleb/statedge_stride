import { create } from 'zustand';

// What the OutboxPill shows. The outbox itself (IndexedDB, flushing, retries) keeps these
// counts current.

export type OutboxStatus = 'saved' | 'saving' | 'offline' | 'attention';

interface OutboxState {
  pending: number;
  failed: number;
  sending: boolean;
  online: boolean;
  set: (next: Partial<Omit<OutboxState, 'set'>>) => void;
}

export const useOutboxStore = create<OutboxState>((set) => ({
  pending: 0,
  failed: 0,
  sending: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  set: (next) => set(next),
}));

export function outboxStatus(
  s: Pick<OutboxState, 'pending' | 'failed' | 'sending' | 'online'>,
): OutboxStatus {
  if (s.failed > 0) return 'attention';
  if (s.pending === 0) return 'saved';
  if (!s.online) return 'offline';
  return 'saving';
}
