import { create } from 'zustand';

// The running analysis job, held in memory until it is saved. The full job state arrives with
// the analysis screen; the shell only needs to know whether a job is running (the update
// prompt never reloads during one).

interface JobState {
  running: boolean;
  setRunning: (running: boolean) => void;
}

export const useJobStore = create<JobState>((set) => ({
  running: false,
  setRunning: (running) => set({ running }),
}));
