import '../lib/zodSetup';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useState, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { ApiProvider, createQueryClient } from '../lib/apiContext';
import { FakeAuthProvider } from '../lib/auth/fakeAuth';
import { onSignOut } from '../lib/auth/signOutCleanup';
import { createMsal, MsalAuthProvider } from '../lib/auth/msalAuth';
import { config } from '../lib/config';
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

export function AppRoot() {
  const [queryClient] = useState(() => {
    const client = createQueryClient();
    onSignOut(async () => {
      client.clear();
      await persister.removeClient();
    });
    return client;
  });
  return (
    <Auth>
      <ApiProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            buster: 'v1',
            dehydrateOptions: {
              shouldDehydrateQuery: (query) =>
                query.state.status === 'success' &&
                PERSISTED_QUERY_KEYS.includes(String(query.queryKey[0])),
            },
          }}
        >
          <OutboxProvider>
            <Outlet />
            <UpdatePrompt />
            <CapabilityNotice />
          </OutboxProvider>
        </PersistQueryClientProvider>
      </ApiProvider>
    </Auth>
  );
}
