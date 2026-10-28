import { create } from 'zustand';
import type { OutboxEntry } from './outbox';

// What the OutboxPill and the outbox panel show. The OutboxProvider keeps it current.

export type OutboxStatus = 'saved' | 'saving' | 'offline' | 'attention';

interface OutboxState {
  entries: OutboxEntry[];
  pending: number;
  failed: number;
  sending: boolean;
  /** Waiting for the coach to sign in again (a 401). */
  paused: boolean;
  online: boolean;
  set: (next: Partial<Omit<OutboxState, 'set'>>) => void;
}

export const useOutboxStore = create<OutboxState>((set) => ({
  entries: [],
  pending: 0,
  failed: 0,
  sending: false,
  paused: false,
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
