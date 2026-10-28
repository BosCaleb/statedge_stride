import type { Note } from '@stride/shared/api/analyses';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import { useQuery } from '@tanstack/react-query';
import { ApiProblem } from '../../lib/api';
import { useApi } from '../../lib/apiContext';
import { useLocalClips, useLocalResults } from '../../lib/local/localQueries';
import type { CopyLocation, LocalResult } from '../../lib/local/records';
import { analysisKey } from './saveResult';

// One analysis for the viewer and the comparison, wherever it is: a result kept on this phone
// (saved or not), or one saved by any coach of the organisation and fetched from the API with
// its keypoint file. The clip plays from this phone's copy, or from the original picked again.

export interface ClipRef {
  id: string;
  copy: CopyLocation;
  fingerprint: string | null;
}

export interface AnalysisSource {
  id: string;
  result: AnalysisResult;
  athleteId: string;
  sessionId: string;
  clipId: string;
  createdAt: string;
  /** gzip of the SKP1 keypoint file, when there is one. */
  keypoints: Blob | null;
  /** The record on this phone, when the analysis was made here. */
  local: LocalResult | null;
  /** True once the save is queued (on this phone) or stored (on the server). */
  saved: boolean;
  notes: Note[];
  clip: ClipRef | null;
}

export type SourceState =
  | { status: 'loading' }
  | { status: 'missing' }
  /** Saved by another phone, not in the cache, and this phone is offline. */
  | { status: 'offline' }
  | { status: 'ready'; source: AnalysisSource };

const notFound = (error: unknown) => error instanceof ApiProblem && error.status === 404;

export function useAnalysisSource(id: string): SourceState {
  const call = useApi();
  const results = useLocalResults();
  const clips = useLocalClips();
  const local = results.data?.find((r) => r.id === id) ?? null;
  const askServer = id !== '' && results.isSuccess && (!local || local.savedAt !== null);
  const server = useQuery({
    queryKey: analysisKey(id),
    queryFn: async ({ signal }) => (await call('getAnalysis', { params: { id }, signal })).data,
    enabled: askServer,
    retry: (failures, error) => !notFound(error) && failures < 2,
  });
  const serverKeypoints = useQuery({
    queryKey: ['keypoints', id],
    queryFn: async ({ signal }) => (await call('getKeypoints', { params: { id }, signal })).data,
    enabled: !local && server.data?.hasKeypoints === true,
    staleTime: Infinity,
    retry: false,
  });
  const clipId = local?.clipId ?? server.data?.clipId ?? '';
  const localClip = clips.data?.find((c) => c.id === clipId);
  const serverClip = useQuery({
    queryKey: ['clip', clipId],
    queryFn: async ({ signal }) => (await call('getClip', { params: { id: clipId }, signal })).data,
    enabled: clipId !== '' && clips.isSuccess && !localClip,
    staleTime: Infinity,
    retry: false,
  });

  if (results.isPending || clips.isPending) return { status: 'loading' };
  const clip: ClipRef | null = localClip
    ? { id: localClip.id, copy: localClip.copy, fingerprint: localClip.fingerprint }
    : serverClip.data
      ? { id: serverClip.data.id, copy: 'none', fingerprint: serverClip.data.fingerprint }
      : null;
  if (local) {
    return {
      status: 'ready',
      source: {
        id,
        result: local.result,
        athleteId: local.athleteId,
        sessionId: local.sessionId,
        clipId: local.clipId,
        createdAt: local.createdAt,
        keypoints: local.keypoints,
        local,
        saved: local.savedAt !== null,
        notes: server.data?.notes ?? [],
        clip,
      },
    };
  }
  if (server.data) {
    return {
      status: 'ready',
      source: {
        id,
        result: server.data.result,
        athleteId: server.data.athleteId,
        sessionId: server.data.sessionId,
        clipId: server.data.clipId,
        createdAt: server.data.createdAt,
        keypoints: serverKeypoints.data ?? null,
        local: null,
        saved: true,
        notes: server.data.notes,
        clip,
      },
    };
  }
  if (server.isPending && askServer)
    return server.fetchStatus === 'paused' ? { status: 'offline' } : { status: 'loading' };
  return { status: 'missing' };
}
