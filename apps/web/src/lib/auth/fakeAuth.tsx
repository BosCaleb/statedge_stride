import { DEV_IDENTITIES } from '@stride/shared/devIdentities';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import {
  AuthContext,
  FakeSignInContext,
  rememberReturnTo,
  type AuthState,
  type FakeIdentity,
} from './authContext';
import { runSignOutCleanup } from './signOutCleanup';

// Local development and end-to-end test builds only (VITE_FAKE_AUTH): sign in as a seeded
// person. The API accepts these tokens only when ENVIRONMENT=local and DEV_FAKE_AUTH=true.

const STORAGE_KEY = 'stride.fakeIdentity';
const identitySchema = z.object({ oid: z.guid(), email: z.email(), name: z.string() });

export const FAKE_IDENTITIES: readonly FakeIdentity[] = DEV_IDENTITIES.map(
  ({ oid, email, name }) => ({ oid, email, name }),
);

function load(): FakeIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = identitySchema.safeParse(raw ? JSON.parse(raw) : null);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The token format the API's fake mode reads: "fake." + base64url(JSON). */
export function fakeToken(identity: FakeIdentity): string {
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `fake.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function FakeAuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<FakeIdentity | null>(load);

  const signInAs = useCallback((next: FakeIdentity) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setIdentity(next);
  }, []);

  const signIn = useCallback((returnTo?: string) => {
    rememberReturnTo(returnTo);
    window.location.assign(
      returnTo ? `/signin?returnTo=${encodeURIComponent(returnTo)}` : '/signin',
    );
    return Promise.resolve();
  }, []);

  const signOut = useCallback(async () => {
    await runSignOutCleanup();
    localStorage.removeItem(STORAGE_KEY);
    setIdentity(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status: identity ? 'signedIn' : 'signedOut',
      account: identity ? { name: identity.name, email: identity.email } : null,
      signIn,
      signOut,
      getToken: () => Promise.resolve(identity ? fakeToken(identity) : null),
    }),
    [identity, signIn, signOut],
  );
  return (
    <AuthContext.Provider value={value}>
      <FakeSignInContext.Provider value={signInAs}>{children}</FakeSignInContext.Provider>
    </AuthContext.Provider>
  );
}
