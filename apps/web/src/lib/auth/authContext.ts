import { createContext, useContext } from 'react';

// The app's view of sign-in, the same for Entra (MSAL) and for the local fake mode.

export interface AuthAccount {
  name: string | null;
  email: string | null;
}

export interface AuthState {
  /** loading until the sign-in library has started and handled any redirect. */
  status: 'loading' | 'signedOut' | 'signedIn';
  account: AuthAccount | null;
  /** Starts sign-in. After it, the app returns to `returnTo`. */
  signIn: (returnTo?: string) => Promise<void>;
  /** Wipes the data kept on this phone, then signs out. */
  signOut: () => Promise<void>;
  /** A bearer token for the API, or null when the coach must sign in again (or is offline). */
  getToken: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthState | null>(null);

/** In fake mode only: signs in as a seeded person. Null with real sign-in. */
export const FakeSignInContext = createContext<((identity: FakeIdentity) => void) | null>(null);

export interface FakeIdentity {
  oid: string;
  email: string;
  name: string;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth needs an AuthProvider');
  return auth;
}

const RETURN_TO_KEY = 'stride.returnTo';

/** Remembers where to go after the sign-in redirect. Only same-origin paths are kept. */
export function rememberReturnTo(path: string | undefined): void {
  try {
    if (path && path.startsWith('/') && !path.startsWith('//'))
      sessionStorage.setItem(RETURN_TO_KEY, path);
    else sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // Storage can be unavailable in private modes; the app then returns to Home.
  }
}

/** Reads (without clearing: render can run twice) where to go after sign-in. */
export function readReturnTo(): string {
  try {
    const path = sessionStorage.getItem(RETURN_TO_KEY);
    return path && path.startsWith('/') && !path.startsWith('//') ? path : '/';
  } catch {
    return '/';
  }
}
