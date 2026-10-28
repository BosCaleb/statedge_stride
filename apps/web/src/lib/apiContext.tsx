import { QueryClient, useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ApiProblem, createApiClient, NetworkError, type ApiCall } from './api';
import { useAuth } from './auth/authContext';
import { config } from './config';

// The API client for the signed-in coach, and the query client. Queries keep working from the
// cache while offline (networkMode offlineFirst), so the analysis loop never waits on the API.
// Unused queries stay in memory as long as the persister keeps them (gcTime), or an offline
// restart would find them gone.

/** How long the persisted query cache is kept, and so how long unused queries stay. */
export const QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const ApiContext = createContext<ApiCall | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const call = useMemo(() => createApiClient({ baseUrl: config.apiBaseUrl, getToken }), [getToken]);
  return <ApiContext.Provider value={call}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiCall {
  const call = useContext(ApiContext);
  if (!call) throw new Error('useApi needs an ApiProvider');
  return call;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        staleTime: 30_000,
        gcTime: QUERY_CACHE_MAX_AGE_MS,
        retry: (failures, error) => error instanceof NetworkError && failures < 3,
      },
      mutations: { networkMode: 'offlineFirst', retry: false },
    },
  });
}

/** GET /v1/me: the coach, organisation and role. */
export function useMe(enabled = true) {
  const call = useApi();
  return useQuery({
    queryKey: ['me'],
    queryFn: async ({ signal }) => (await call('me', { signal })).data,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function problemCode(error: unknown): string | null {
  return error instanceof ApiProblem ? error.code : null;
}
