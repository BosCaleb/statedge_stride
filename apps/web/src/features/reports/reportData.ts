import type { ShareCreated } from '@stride/shared/api/reports';
import { LIMITS } from '@stride/shared/limits';
import type { ReportSnapshot } from '@stride/shared/reportSnapshot';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ApiProblem } from '../../lib/api';
import { useApi } from '../../lib/apiContext';
import { getReportFrames, putReportFrames } from '../../lib/local/reportFrames';
import { useOutbox } from '../../lib/outbox/OutboxProvider';

// Reports on the server: saving one through the outbox (its frames stay on this phone until a
// link is made), reading one and an athlete's list, and making or revoking a share link. A link
// needs a connection, so it is made directly rather than queued; revoking is queued like any
// other write, so that it happens even when the phone is offline.

export const reportKeys = {
  one: (id: string) => ['report', id] as const,
  athlete: (athleteId: string) => ['reports', athleteId] as const,
};

const notFound = (error: unknown) => error instanceof ApiProblem && error.status === 404;

export function useReport(id: string, enabled = true) {
  const call = useApi();
  return useQuery({
    queryKey: reportKeys.one(id),
    queryFn: async ({ signal }) => (await call('getReport', { params: { id }, signal })).data,
    enabled: enabled && id !== '',
    retry: (failures, error) => !notFound(error) && failures < 2,
  });
}

export function useAthleteReports(athleteId: string) {
  const call = useApi();
  return useQuery({
    queryKey: reportKeys.athlete(athleteId),
    queryFn: async ({ signal }) =>
      (await call('listAthleteReports', { params: { id: athleteId }, signal })).data.items,
    enabled: athleteId !== '',
  });
}

/** Keeps the frames on the phone and queues the report. Last write wins on the server. */
export function useSaveReport() {
  const outbox = useOutbox();
  return useCallback(
    async (input: {
      reportId: string;
      athleteId: string;
      snapshot: ReportSnapshot;
      frames: readonly Blob[];
      label: string;
    }) => {
      await putReportFrames(input.reportId, input.frames);
      await outbox.enqueue({
        route: 'putReport',
        params: { id: input.reportId },
        body: { athleteId: input.athleteId, snapshot: input.snapshot },
        resource: { type: 'report', id: input.reportId },
        needs: input.snapshot.analyses.map((a) => ({ type: 'analysis', id: a.id })),
        label: input.label,
        invalidates: [
          [...reportKeys.one(input.reportId)],
          [...reportKeys.athlete(input.athleteId)],
        ],
      });
      void outbox.flush();
    },
    [outbox],
  );
}

export type ShareFailure = 'offline' | 'not_saved' | 'frames_missing' | 'consent' | 'other';

export class ShareError extends Error {
  constructor(readonly reason: ShareFailure) {
    super(reason);
    this.name = 'ShareError';
  }
}

/** Uploads the frames the server lacks, then creates the link. The URL is shown only once. */
export function useCreateShare() {
  const call = useApi();
  const outbox = useOutbox();
  const queryClient = useQueryClient();
  return useCallback(
    async (reportId: string, athleteId: string, expiresInDays: number): Promise<ShareCreated> => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ShareError('offline');
      await outbox.flushNow();
      if (
        (await outbox.list()).some(
          (e) => e.resource?.type === 'report' && e.resource.id === reportId,
        )
      )
        throw new ShareError('not_saved');
      try {
        const report = (await call('getReport', { params: { id: reportId } })).data;
        const local = await getReportFrames(reportId);
        for (const frame of report.snapshot.frames) {
          if (report.frameOrdinals.includes(frame.ordinal)) continue;
          const jpeg = local.get(frame.ordinal);
          if (!jpeg) throw new ShareError('frames_missing');
          await call('putReportFrame', {
            params: { id: reportId, ordinal: String(frame.ordinal) },
            body: jpeg,
          });
        }
        const link = (
          await call('createShare', {
            params: { id: reportId },
            body: { expiresInDays: Math.min(expiresInDays, LIMITS.shareMaxDays) },
          })
        ).data;
        await queryClient.invalidateQueries({ queryKey: reportKeys.one(reportId) });
        await queryClient.invalidateQueries({ queryKey: reportKeys.athlete(athleteId) });
        return link;
      } catch (error) {
        if (error instanceof ShareError) throw error;
        if (error instanceof ApiProblem && error.code === 'consent_required')
          throw new ShareError('consent');
        if (error instanceof ApiProblem && error.status === 404) throw new ShareError('not_saved');
        if (error instanceof TypeError) throw new ShareError('offline');
        throw new ShareError('other');
      }
    },
    [call, outbox, queryClient],
  );
}

export function useRevokeShare() {
  const outbox = useOutbox();
  return useCallback(
    async (reportId: string, athleteId: string, label: string) => {
      await outbox.enqueue({
        route: 'revokeShare',
        params: { id: reportId },
        needs: [{ type: 'report', id: reportId }],
        label,
        invalidates: [[...reportKeys.one(reportId)], [...reportKeys.athlete(athleteId)]],
      });
      void outbox.flush();
    },
    [outbox],
  );
}
