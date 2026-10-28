import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorState, LoadingState } from '../components/States';
import { problemCode, useMe } from '../lib/apiContext';
import { useAuth } from '../lib/auth/authContext';
import { strings } from '../lib/strings';

/**
 * Guards signed-in routes and checks the role from GET /v1/me. Once /v1/me has been seen, the
 * cached answer is enough: the analysis loop keeps working offline or with an expired token,
 * and only saving needs a fresh sign-in.
 */
export function RequireAuth({ role }: { role?: 'admin' }) {
  const auth = useAuth();
  const location = useLocation();
  const me = useMe(auth.status === 'signedIn');

  if (auth.status === 'loading') return <LoadingState />;
  if (auth.status === 'signedOut') {
    const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/signin?returnTo=${returnTo}`} replace />;
  }
  const code = problemCode(me.error);
  if (code === 'not_enrolled')
    return <ErrorState title={strings.auth.notEnrolledTitle} body={strings.auth.notEnrolledBody} />;
  if (code === 'forbidden')
    return <ErrorState title={strings.auth.removedTitle} body={strings.auth.removedBody} />;
  if (!me.data) {
    if (me.isPending) return <LoadingState />;
    if (code === 'unauthorised') {
      return (
        <ErrorState
          title={strings.auth.sessionExpired}
          onRetry={() => void auth.signIn(location.pathname)}
        />
      );
    }
    return (
      <ErrorState
        title={navigator.onLine ? strings.errors.title : strings.errors.offline}
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (role === 'admin' && me.data.coach.role !== 'admin')
    return <ErrorState title={strings.auth.adminOnly} />;
  return <Outlet />;
}

/** RequireAuth for administrator-only routes such as Settings. */
export function RequireAdmin() {
  return <RequireAuth role="admin" />;
}
