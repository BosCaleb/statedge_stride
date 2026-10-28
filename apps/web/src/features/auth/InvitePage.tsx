import { useParams } from 'react-router';
import { LoadingState } from '../../components/States';
import { useAuth } from '../../lib/auth/authContext';
import { strings } from '../../lib/strings';
import ui from '../../components/ui.module.css';
import { AuthScreen } from './AuthScreen';

/** /invite/:token: sign in first, then join the organisation. */
export function InvitePage() {
  const auth = useAuth();
  const { token = '' } = useParams();
  if (auth.status === 'loading') return <LoadingState />;
  return (
    <AuthScreen>
      <h1>{strings.invite.title}</h1>
      <p>{strings.invite.intro}</p>
      {auth.status === 'signedOut' ? (
        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${ui.block}`}
          onClick={() => void auth.signIn(`/invite/${encodeURIComponent(token)}`)}
        >
          {strings.auth.signInButton}
        </button>
      ) : null}
    </AuthScreen>
  );
}
