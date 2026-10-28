import type { AnalysisResult } from '@stride/shared/analysisResult';
import type { FailCode, Stage } from '@stride/shared/enums';
import { create } from 'zustand';
import type { JobHandle } from '../analysis-runtime/jobRunner';

// The running analysis job: its stage, progress, pause state and cancel handle, and the outcome
// in memory. The shell reads `running` so that the update prompt never reloads during a job.

export interface RunningJob {
  clipId: string;
  handle: JobHandle;
  stage: Stage;
  /** 0 to 1 within the stage; by frame while finding the athlete. */
  fraction: number;
  startedAt: number;
  paused: boolean;
  /** True once the page was hidden during this job. */
  wasPaused: boolean;
}

/** How a job ended: a result kept on the phone, a failed quality gate, or a runtime failure. */
export type FinishedJob =
  | { kind: 'kept'; resultId: string }
  /** Nothing is kept: a failed result has no metrics and cannot be saved. */
  | { kind: 'gate_failed'; result: AnalysisResult }
  | { kind: 'failed'; code: FailCode; detail: string };

interface JobState {
  running: boolean;
  job: RunningJob | null;
  /** The last finished job, until the next one starts. */
  outcome: { clipId: string; finished: FinishedJob } | null;
  begin: (clipId: string, handle: JobHandle) => void;
  progress: (stage: Stage, fraction: number) => void;
  setPaused: (paused: boolean) => void;
  finish: (clipId: string, finished: FinishedJob) => void;
  clearOutcome: () => void;
}

export const useJobStore = create<JobState>((set) => ({
  running: false,
  job: null,
  outcome: null,
  begin: (clipId, handle) =>
    set({
      running: true,
      outcome: null,
      job: {
        clipId,
        handle,
        stage: 'reading',
        fraction: 0,
        startedAt: Date.now(),
        paused: false,
        wasPaused: false,
      },
    }),
  progress: (stage, fraction) => set((s) => (s.job ? { job: { ...s.job, stage, fraction } } : {})),
  setPaused: (paused) =>
    set((s) => (s.job ? { job: { ...s.job, paused, wasPaused: s.job.wasPaused || paused } } : {})),
  finish: (clipId, finished) => set({ running: false, job: null, outcome: { clipId, finished } }),
  clearOutcome: () => set({ outcome: null }),
}));
