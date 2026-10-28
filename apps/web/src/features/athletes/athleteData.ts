import type { Athlete, AthletePut, Consent, ConsentPut } from '@stride/shared/api/athletes';
import type { ConsentPurpose } from '@stride/shared/enums';
import { shortDisplayName } from '@stride/shared/reportSnapshot';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi, useMe } from '../../lib/apiContext';
import { useOutbox } from '../../lib/outbox/OutboxProvider';
import type { ApiCall } from '../../lib/api';

// Athletes and consent on the phone: read through the (persisted) query cache, written through
// the outbox with an optimistic update, so that everything works with no signal.

export const athleteKeys = {
  all: ['athletes'] as const,
  one: (id: string) => ['athlete', id] as const,
  consents: (id: string) => ['consents', id] as const,
};

/** Every athlete of the organisation, all pages. Searching filters this list on the phone. */
async function fetchAllAthletes(call: ApiCall, signal: AbortSignal): Promise<Athlete[]> {
  const items: Athlete[] = [];
  let cursor: string | undefined;
  do {
    const page = (
      await call('listAthletes', { query: { limit: 100, ...(cursor ? { cursor } : {}) }, signal })
    ).data;
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

export function useAthletes() {
  const call = useApi();
  return useQuery({
    queryKey: athleteKeys.all,
    queryFn: ({ signal }) => fetchAllAthletes(call, signal),
  });
}

export function useAthlete(id: string) {
  const call = useApi();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: athleteKeys.one(id),
    queryFn: async ({ signal }) => (await call('getAthlete', { params: { id }, signal })).data,
    initialData: () =>
      queryClient.getQueryData<Athlete[]>(athleteKeys.all)?.find((a) => a.id === id),
    enabled: id !== '',
  });
}

export function useConsentHistory(id: string) {
  const call = useApi();
  return useQuery({
    queryKey: athleteKeys.consents(id),
    queryFn: async ({ signal }) =>
      (await call('listConsents', { params: { id }, signal })).data.items,
    enabled: id !== '',
  });
}

function storeAthlete(queryClient: QueryClient, athlete: Athlete): void {
  queryClient.setQueryData(athleteKeys.one(athlete.id), athlete);
  queryClient.setQueryData<Athlete[]>(athleteKeys.all, (list = []) => {
    const others = list.filter((a) => a.id !== athlete.id);
    return [...others, athlete].sort(
      (x, y) =>
        x.lastName.localeCompare(y.lastName) ||
        x.firstName.localeCompare(y.firstName) ||
        x.id.localeCompare(y.id),
    );
  });
}

function findAthlete(queryClient: QueryClient, id: string): Athlete | undefined {
  return (
    queryClient.getQueryData<Athlete>(athleteKeys.one(id)) ??
    queryClient.getQueryData<Athlete[]>(athleteKeys.all)?.find((a) => a.id === id)
  );
}

const refresh = (id: string) => [
  [...athleteKeys.all],
  [...athleteKeys.one(id)],
  [...athleteKeys.consents(id)],
];

export function useSaveAthlete() {
  const queryClient = useQueryClient();
  const outbox = useOutbox();
  return useCallback(
    async (id: string, put: AthletePut) => {
      const existing = findAthlete(queryClient, id);
      storeAthlete(queryClient, {
        id,
        firstName: put.firstName.trim(),
        lastName: put.lastName.trim(),
        birthYear: put.birthYear,
        externalRef: put.externalRef?.trim() || null,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        consents: existing?.consents ?? { analysis: null, sharing: null, clip_storage: null },
      });
      await outbox.enqueue({
        route: 'putAthlete',
        params: { id },
        body: put,
        resource: { type: 'athlete', id },
        label: shortDisplayName(put.firstName, put.lastName),
        invalidates: refresh(id),
      });
      void outbox.flush();
    },
    [queryClient, outbox],
  );
}

export function useRecordConsents() {
  const queryClient = useQueryClient();
  const outbox = useOutbox();
  const me = useMe();
  return useCallback(
    async (athlete: Athlete, consents: { id: string; put: ConsentPut }[]) => {
      const recordedAt = new Date().toISOString();
      const created: Consent[] = consents.map(({ id, put }) => ({
        id,
        athleteId: athlete.id,
        purpose: put.purpose,
        givenBy: put.givenBy,
        givenByName: put.givenByName,
        relationship: put.relationship ?? null,
        evidence: put.evidence,
        givenOn: put.givenOn,
        recordedBy: me.data?.coach.id ?? '',
        recordedAt,
        withdrawnAt: null,
      }));
      const summary = { ...athlete.consents };
      for (const c of created) summary[c.purpose] = c;
      storeAthlete(queryClient, { ...athlete, consents: summary });
      queryClient.setQueryData<Consent[]>(athleteKeys.consents(athlete.id), (list = []) => [
        ...created,
        ...list,
      ]);
      for (const { id, put } of consents) {
        await outbox.enqueue({
          route: 'putConsent',
          params: { id },
          body: put,
          resource: { type: 'consent', id },
          needs: [{ type: 'athlete', id: athlete.id }],
          label: shortDisplayName(athlete.firstName, athlete.lastName),
          invalidates: refresh(athlete.id),
        });
      }
      void outbox.flush();
    },
    [queryClient, outbox, me.data],
  );
}

export function useWithdrawConsent() {
  const queryClient = useQueryClient();
  const outbox = useOutbox();
  return useCallback(
    async (athlete: Athlete, purpose: ConsentPurpose) => {
      const consent = athlete.consents[purpose];
      if (!consent) return;
      const withdrawnAt = new Date().toISOString();
      storeAthlete(queryClient, { ...athlete, consents: { ...athlete.consents, [purpose]: null } });
      queryClient.setQueryData<Consent[]>(athleteKeys.consents(athlete.id), (list = []) =>
        list.map((c) => (c.id === consent.id ? { ...c, withdrawnAt } : c)),
      );
      await outbox.enqueue({
        route: 'withdrawConsent',
        params: { id: consent.id },
        needs: [{ type: 'consent', id: consent.id }],
        label: shortDisplayName(athlete.firstName, athlete.lastName),
        invalidates: refresh(athlete.id),
      });
      void outbox.flush();
    },
    [queryClient, outbox],
  );
}

/** True when the athlete has an active consent for analysis (needed to analyse and to save). */
export function canAnalyse(athlete: Athlete | undefined): boolean {
  return Boolean(athlete?.consents.analysis);
}
