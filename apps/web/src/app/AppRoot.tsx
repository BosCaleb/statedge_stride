import '../lib/zodSetup';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { ApiProvider, createQueryClient, QUERY_CACHE_MAX_AGE_MS } from '../lib/apiContext';
import { FakeAuthProvider } from '../lib/auth/fakeAuth';
import { useAuth } from '../lib/auth/authContext';
import { onSignOut, signOutUnfinished } from '../lib/auth/signOutCleanup';
import { createMsal, MsalAuthProvider } from '../lib/auth/msalAuth';
import { config } from '../lib/config';
import { clearLocalData } from '../lib/local/cleanup';
import { OutboxProvider } from '../lib/outbox/OutboxProvider';
import { idbPersister, PERSISTED_QUERY_KEYS } from '../lib/queryPersister';
import { CapabilityNotice } from './CapabilityNotice';
import { UpdatePrompt } from './UpdatePrompt';

// Everything below the public report route: sign-in, the API client, the query cache, the
// update prompt and the first-launch capability check. Loaded as its own chunk, so the public
// report viewer never downloads the sign-in library.

const entra = config.entra;
const msal = !config.fakeAuth && entra ? createMsal(entra) : null;

function Auth({ children }: { children: ReactNode }) {
  if (msal && entra) {
    return (
      <MsalAuthProvider msal={msal} entra={entra}>
        {children}
      </MsalAuthProvider>
    );
  }
  return <FakeAuthProvider>{children}</FakeAuthProvider>;
}

const persister = idbPersister();

/** Finishes a sign-out whose wipe was interrupted (the app closed or reloaded during it). */
function FinishSignOut() {
  const auth = useAuth();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || auth.status === 'loading') return;
    done.current = true;
    if (signOutUnfinished()) void auth.signOut();
  }, [auth]);
  return null;
}

export function AppRoot() {
  const [queryClient] = useState(() => {
    const client = createQueryClient();
    onSignOut(async () => {
      client.clear();
      await persister.removeClient();
    });
    onSignOut(clearLocalData);
    return client;
  });
  return (
    <Auth>
      <ApiProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: QUERY_CACHE_MAX_AGE_MS,
            buster: 'v1',
            dehydrateOptions: {
              shouldDehydrateQuery: (query) =>
                query.state.status === 'success' &&
                PERSISTED_QUERY_KEYS.includes(String(query.queryKey[0])),
            },
          }}
        >
          <OutboxProvider>
            <FinishSignOut />
            <Outlet />
            <UpdatePrompt />
            <CapabilityNotice />
          </OutboxProvider>
        </PersistQueryClientProvider>
      </ApiProvider>
    </Auth>
  );
}
