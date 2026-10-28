import '../lib/zodSetup';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { createQueryClient, ApiProvider } from '../lib/apiContext';
import { FakeAuthProvider } from '../lib/auth/fakeAuth';
import { onSignOut } from '../lib/auth/signOutCleanup';
import { createMsal, MsalAuthProvider } from '../lib/auth/msalAuth';
import { config } from '../lib/config';
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

export function AppRoot() {
  const [queryClient] = useState(() => {
    const client = createQueryClient();
    onSignOut(() => client.clear());
    return client;
  });
  return (
    <Auth>
      <ApiProvider>
        <QueryClientProvider client={queryClient}>
          <Outlet />
          <UpdatePrompt />
          <CapabilityNotice />
        </QueryClientProvider>
      </ApiProvider>
    </Auth>
  );
}
