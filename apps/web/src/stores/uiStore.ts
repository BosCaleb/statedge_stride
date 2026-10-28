import { create } from 'zustand';

// Session and UI state that is not server data: the session being worked on and the athletes
// picked for it (offered first on import). In memory only; nothing here is personal data
// beyond ids.

interface UiState {
  activeSessionId: string | null;
  /** Athletes picked when each session was created on this phone, by session id. */
  sessionAthletes: Record<string, string[]>;
  setActiveSession: (sessionId: string | null) => void;
  setSessionAthletes: (sessionId: string, athleteIds: string[]) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeSessionId: null,
  sessionAthletes: {},
  setActiveSession: (activeSessionId) => set({ activeSessionId }),
  setSessionAthletes: (sessionId, athleteIds) =>
    set((s) => ({ sessionAthletes: { ...s.sessionAthletes, [sessionId]: athleteIds } })),
}));
