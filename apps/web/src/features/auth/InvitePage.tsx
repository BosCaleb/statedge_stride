import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { ApiProblem } from '../../lib/api';
import { useApi } from '../../lib/apiContext';
import { useAuth } from '../../lib/auth/authContext';
import { strings } from '../../lib/strings';
import { AuthScreen } from './AuthScreen';

type State =
  | { kind: 'idle' | 'joining' }
  | { kind: 'joined'; org: string }
  | { kind: 'failed'; message: string };

/** /invite/:token: sign in (or up) with the invited email, then join the organisation. */
export function InvitePage() {
  const auth = useAuth();
  const call = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const started = useRef(false);

  useEffect(() => {
    if (auth.status !== 'signedIn' || started.current) return;
    started.current = true;
    setState({ kind: 'joining' });
    call('acceptInvite', { body: { token } })
      .then(({ data }) => {
        queryClient.setQueryData(['me'], data);
        setState({ kind: 'joined', org: data.organisation.name });
      })
      .catch((error: unknown) => {
        const code = error instanceof ApiProblem ? error.code : null;
        const known =
          code === 'not_found' ||
          code === 'conflict' ||
          code === 'forbidden' ||
          code === 'seat_limit';
        setState({
          kind: 'failed',
          message: known ? strings.invite.errors[code] : strings.invite.errors.other,
        });
      });
  }, [auth.status, call, queryClient, token]);

  if (auth.status === 'loading' || state.kind === 'joining')
    return <LoadingState label={strings.invite.joining} />;

  return (
    <AuthScreen>
      <h1>{strings.invite.title}</h1>
      {auth.status === 'signedOut' ? (
        <>
          <p>{strings.invite.intro}</p>
          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${ui.block}`}
            onClick={() => void auth.signIn(`/invite/${encodeURIComponent(token)}`)}
          >
            {strings.auth.signInButton}
          </button>
        </>
      ) : state.kind === 'joined' ? (
        <>
          <p role="status">{strings.invite.joined(state.org)}</p>
          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${ui.block}`}
            onClick={() => void navigate('/', { replace: true })}
          >
            {strings.invite.continue}
          </button>
        </>
      ) : state.kind === 'failed' ? (
        <>
          <p role="alert">{state.message}</p>
          <button
            type="button"
            className={`${ui.button} ${ui.quiet} ${ui.block}`}
            onClick={() => void auth.signOut()}
          >
            {strings.invite.otherAccount}
          </button>
        </>
      ) : null}
    </AuthScreen>
  );
}
