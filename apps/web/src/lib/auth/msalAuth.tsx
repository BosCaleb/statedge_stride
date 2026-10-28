import {
  BrowserCacheLocation,
  EventType,
  InteractionRequiredAuthError,
  InteractionStatus,
  PublicClientApplication,
  type AuthenticationResult,
} from '@azure/msal-browser';
import { MsalProvider, useMsal } from '@azure/msal-react';
import { useCallback, useMemo, type ReactNode } from 'react';
import type { WebConfig } from '../config';
import { AuthContext, rememberReturnTo, type AuthState } from './authContext';
import { runSignOutCleanup } from './signOutCleanup';

// Entra External ID with the redirect flow (mobile browsers handle popups badly). Tokens are
// cached in localStorage so that the installed app keeps the coach signed in; the strict
// content security policy limits the script-injection risk that comes with it.

type Entra = NonNullable<WebConfig['entra']>;

export function createMsal(entra: Entra): PublicClientApplication {
  const msal = new PublicClientApplication({
    auth: {
      clientId: entra.clientId,
      authority: entra.authority,
      knownAuthorities: [entra.knownAuthority],
      redirectUri: `${window.location.origin}/auth/callback`,
      postLogoutRedirectUri: `${window.location.origin}/signin`,
    },
    cache: { cacheLocation: BrowserCacheLocation.LocalStorage },
    system: { loggerOptions: { piiLoggingEnabled: false } },
  });
  msal.addEventCallback((event) => {
    if (
      event.eventType === EventType.LOGIN_SUCCESS ||
      event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS
    ) {
      const account = (event.payload as AuthenticationResult | null)?.account;
      if (account) msal.setActiveAccount(account);
    }
  });
  return msal;
}

function MsalAdapter({ entra, children }: { entra: Entra; children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const account = instance.getActiveAccount() ?? accounts[0] ?? null;

  const signIn = useCallback(
    async (returnTo?: string) => {
      rememberReturnTo(returnTo);
      await instance.loginRedirect({ scopes: [entra.scope] });
    },
    [instance, entra.scope],
  );

  const signOut = useCallback(async () => {
    await runSignOutCleanup();
    await instance.logoutRedirect({ account });
  }, [instance, account]);

  const getToken = useCallback(async () => {
    if (!account) return null;
    try {
      const result = await instance.acquireTokenSilent({ scopes: [entra.scope], account });
      return result.accessToken;
    } catch (error) {
      // Interaction needed (session expired) or offline: saving waits until the coach signs in.
      if (!(error instanceof InteractionRequiredAuthError))
        console.warn('token refresh failed', error);
      return null;
    }
  }, [instance, account, entra.scope]);

  const value = useMemo<AuthState>(() => {
    const claims = account?.idTokenClaims as { email?: unknown } | undefined;
    return {
      status:
        inProgress === InteractionStatus.Startup || inProgress === InteractionStatus.HandleRedirect
          ? 'loading'
          : account
            ? 'signedIn'
            : 'signedOut',
      account: account
        ? {
            name: account.name ?? null,
            email: typeof claims?.email === 'string' ? claims.email : account.username || null,
          }
        : null,
      signIn,
      signOut,
      getToken,
    };
  }, [account, inProgress, signIn, signOut, getToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function MsalAuthProvider({
  msal,
  entra,
  children,
}: {
  msal: PublicClientApplication;
  entra: Entra;
  children: ReactNode;
}) {
  return (
    <MsalProvider instance={msal}>
      <MsalAdapter entra={entra}>{children}</MsalAdapter>
    </MsalProvider>
  );
}
