import { Navigate } from 'react-router';
import { ErrorState, LoadingState } from '../../components/States';
import { readReturnTo, useAuth } from '../../lib/auth/authContext';
import { strings } from '../../lib/strings';
import { AuthScreen } from './AuthScreen';

/** /auth/callback: MSAL finishes the redirect (in MsalProvider), then the app goes back. */
export function AuthCallbackPage() {
  const auth = useAuth();
  if (auth.status === 'loading') return <LoadingState label={strings.auth.signingIn} />;
  if (auth.status === 'signedIn') return <Navigate to={readReturnTo()} replace />;
  return (
    <AuthScreen>
      <ErrorState title={strings.auth.callbackFailed} onRetry={() => void auth.signIn()} />
    </AuthScreen>
  );
}
