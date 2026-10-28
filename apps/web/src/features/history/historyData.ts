import type { HistoryEntry } from '@stride/shared/api/analyses';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import type { Confidence, MetricId, Mode, SavedGateStatus } from '@stride/shared/enums';
import { LIMITS } from '@stride/shared/limits';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/apiContext';
import { useLocalResults } from '../../lib/local/localQueries';
import type { LocalResult } from '../../lib/local/records';
import { historyKey } from '../results/saveResult';
import { useSessions } from '../sessions/sessionData';

// An athlete's analyses for the history list, trends and the comparison: the saved ones from the
// API (the most recent page) and the ones on this phone that are not saved yet.

export interface HistoryMetric {
  metricId: MetricId;
  value: number | null;
  unit: string;
  confidence: Confidence;
}

export interface HistoryRow {
  id: string;
  sessionId: string;
  sessionDate: string;
  createdAt: string;
  mode: Mode;
  gateStatus: SavedGateStatus;
  saved: boolean;
  metrics: HistoryMetric[];
}

function measured(result: AnalysisResult): HistoryMetric[] {
  return result.metrics
    .filter((m) => m.value !== null && m.confidence !== 'unavailable')
    .map((m) => ({ metricId: m.id, value: m.value, unit: m.unit, confidence: m.confidence }));
}

export function rowFromLocal(r: LocalResult, sessionDate: string | undefined): HistoryRow {
  return {
    id: r.id,
    sessionId: r.sessionId,
    sessionDate: sessionDate ?? r.createdAt.slice(0, 10),
    createdAt: r.createdAt,
    mode: r.result.mode,
    gateStatus: r.result.gate.status === 'pass' ? 'pass' : 'conditional',
    saved: false,
    metrics: measured(r.result),
  };
}

export function rowFromServer(e: HistoryEntry): HistoryRow {
  return {
    id: e.id,
    sessionId: e.sessionId,
    sessionDate: e.sessionDate,
    createdAt: e.createdAt,
    mode: e.mode,
    gateStatus: e.gateStatus,
    saved: true,
    metrics: e.metrics.map((m) => ({
      metricId: m.metricId,
      value: m.value,
      unit: m.unit,
      confidence: m.confidence,
    })),
  };
}

/** Saved and unsaved rows together, newest session first, each analysis once. */
export function mergeHistory(server: HistoryRow[], local: HistoryRow[]): HistoryRow[] {
  const ids = new Set(server.map((r) => r.id));
  return [...server, ...local.filter((r) => !ids.has(r.id))].sort(
    (a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.createdAt.localeCompare(a.createdAt),
  );
}

export function useAthleteHistory(athleteId: string) {
  const call = useApi();
  const results = useLocalResults();
  const sessions = useSessions();
  const server = useQuery({
    queryKey: historyKey(athleteId),
    queryFn: async ({ signal }) =>
      (
        await call('athleteAnalyses', {
          params: { id: athleteId },
          query: { limit: LIMITS.pageMax },
          signal,
        })
      ).data.items,
    enabled: athleteId !== '',
  });
  const dates = new Map((sessions.data ?? []).map((s) => [s.id, s.sessionDate]));
  const local = (results.data ?? [])
    .filter((r) => r.athleteId === athleteId && r.savedAt === null)
    .map((r) => rowFromLocal(r, dates.get(r.sessionId)));
  return {
    rows: mergeHistory((server.data ?? []).map(rowFromServer), local),
    isPending: server.isPending && results.isPending,
    isError: server.isError && !server.data,
  };
}
