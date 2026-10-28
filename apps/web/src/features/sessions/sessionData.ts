import type { Session, SessionDetail, SessionPut } from '@stride/shared/api/sessions';
import { sessionPutSchema } from '@stride/shared/api/sessions';
import { formatDisplayDate } from '@stride/shared/dates';
import { LIMITS } from '@stride/shared/limits';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ApiProblem } from '../../lib/api';
import { useApi, useMe } from '../../lib/apiContext';
import { useOutbox } from '../../lib/outbox/OutboxProvider';
import type { Outbox, OutboxEntry } from '../../lib/outbox/outbox';
import { strings } from '../../lib/strings';

// Sessions on the phone: read through the (persisted) query cache, written through the outbox
// with an optimistic update. A session created offline lives in the outbox until it is sent, so
// reads merge the queued sessions into what the server returns.

export const sessionKeys = {
  all: ['sessions'] as const,
  one: (id: string) => ['session', id] as const,
};

function newestFirst(a: Session, b: Session): number {
  return (
    b.sessionDate.localeCompare(a.sessionDate) ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

export function sessionFromPut(
  id: string,
  put: SessionPut,
  createdBy: string,
  createdAt: string,
): Session {
  return {
    id,
    sessionDate: put.sessionDate,
    place: put.place?.trim() || null,
    surface: put.surface ?? null,
    footwear: put.footwear?.trim() || null,
    mode: put.mode,
    notes: put.notes?.trim() || null,
    createdBy,
    createdAt,
  };
}

/** Sessions written on this phone and not yet sent, newest write last. */
export function queuedSessions(entries: OutboxEntry[], coachId: string): Session[] {
  const byId = new Map<string, Session>();
  for (const entry of entries) {
    const id = entry.params?.id;
    if (entry.route !== 'putSession' || !id) continue;
    const put = sessionPutSchema.safeParse(entry.body);
    if (!put.success) continue;
    const createdAt = byId.get(id)?.createdAt ?? new Date(entry.createdAt).toISOString();
    byId.set(id, sessionFromPut(id, put.data, coachId, createdAt));
  }
  return [...byId.values()];
}

/** The server's list with queued writes laid over it. */
export function mergeQueued(server: Session[], queued: Session[]): Session[] {
  const byId = new Map(server.map((s) => [s.id, s]));
  for (const q of queued) {
    const known = byId.get(q.id);
    byId.set(q.id, known ? { ...q, createdBy: known.createdBy, createdAt: known.createdAt } : q);
  }
  return [...byId.values()].sort(newestFirst);
}

async function queued(outbox: Outbox, coachId: string | undefined): Promise<Session[]> {
  return coachId ? queuedSessions(await outbox.list(), coachId) : [];
}

/** The most recent sessions (one page of the API's maximum size). */
export function useSessions() {
  const call = useApi();
  const outbox = useOutbox();
  const me = useMe();
  const coachId = me.data?.coach.id;
  return useQuery({
    queryKey: sessionKeys.all,
    queryFn: async ({ signal }) => {
      const page = (await call('listSessions', { query: { limit: LIMITS.pageMax }, signal })).data;
      return mergeQueued(page.items, await queued(outbox, coachId));
    },
  });
}

export function useSession(id: string) {
  const call = useApi();
  const outbox = useOutbox();
  const me = useMe();
  const queryClient = useQueryClient();
  const coachId = me.data?.coach.id;
  return useQuery({
    queryKey: sessionKeys.one(id),
    queryFn: async ({ signal }): Promise<SessionDetail> => {
      const mine = (await queued(outbox, coachId)).find((s) => s.id === id);
      try {
        const detail = (await call('getSession', { params: { id }, signal })).data;
        return mine
          ? { ...detail, session: { ...mine, createdAt: detail.session.createdAt } }
          : detail;
      } catch (error) {
        // Created on this phone and not sent yet.
        if (mine && error instanceof ApiProblem && error.status === 404)
          return { session: mine, calibrations: [], clips: [], analyses: [] };
        throw error;
      }
    },
    initialData: () => {
      const session = queryClient
        .getQueryData<Session[]>(sessionKeys.all)
        ?.find((s) => s.id === id);
      return session ? { session, calibrations: [], clips: [], analyses: [] } : undefined;
    },
    initialDataUpdatedAt: 0,
    enabled: id !== '',
  });
}

function storeSession(queryClient: QueryClient, session: Session): void {
  queryClient.setQueryData<SessionDetail>(sessionKeys.one(session.id), (detail) =>
    detail ? { ...detail, session } : { session, calibrations: [], clips: [], analyses: [] },
  );
  queryClient.setQueryData<Session[]>(sessionKeys.all, (list = []) => mergeQueued(list, [session]));
}

export function useSaveSession() {
  const queryClient = useQueryClient();
  const outbox = useOutbox();
  const me = useMe();
  return useCallback(
    async (id: string, put: SessionPut) => {
      const existing = queryClient.getQueryData<SessionDetail>(sessionKeys.one(id))?.session;
      storeSession(
        queryClient,
        sessionFromPut(
          id,
          put,
          existing?.createdBy ?? me.data?.coach.id ?? '',
          existing?.createdAt ?? new Date().toISOString(),
        ),
      );
      await outbox.enqueue({
        route: 'putSession',
        params: { id },
        body: put,
        resource: { type: 'session', id },
        label: strings.sessions.outboxLabel(formatDisplayDate(put.sessionDate)),
        invalidates: [[...sessionKeys.all], [...sessionKeys.one(id)]],
      });
      void outbox.flush();
    },
    [queryClient, outbox, me.data],
  );
}
