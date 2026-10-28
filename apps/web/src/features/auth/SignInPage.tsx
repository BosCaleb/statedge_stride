import { useContext, useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { LoadingState } from '../../components/States';
import {
  FakeSignInContext,
  readReturnTo,
  rememberReturnTo,
  useAuth,
} from '../../lib/auth/authContext';
import { FAKE_IDENTITIES } from '../../lib/auth/fakeAuth';
import { strings } from '../../lib/strings';
import ui from '../../components/ui.module.css';
import { AuthScreen } from './AuthScreen';
import styles from './auth.module.css';

/** /signin: the Entra redirect flow, or a seeded-person picker in fake mode. */
export function SignInPage() {
  const auth = useAuth();
  const fakeSignIn = useContext(FakeSignInContext);
  const [search] = useSearchParams();
  const returnTo = search.get('returnTo') ?? undefined;

  useEffect(() => {
    if (returnTo) rememberReturnTo(returnTo);
  }, [returnTo]);

  if (auth.status === 'loading') return <LoadingState label={strings.auth.signingIn} />;
  if (auth.status === 'signedIn') return <Navigate to={readReturnTo()} replace />;

  return (
    <AuthScreen>
      <h1>{fakeSignIn ? strings.auth.fakeTitle : strings.auth.signInTitle}</h1>
      {fakeSignIn ? (
        <>
          <p>{strings.auth.fakeIntro}</p>
          <ul className={styles.people}>
            {FAKE_IDENTITIES.map((person) => (
              <li key={person.oid}>
                <button
                  type="button"
                  className={`${ui.button} ${ui.quiet} ${ui.block}`}
                  onClick={() => fakeSignIn(person)}
                >
                  {strings.auth.fakeAs(person.email)}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p>{strings.auth.signInIntro}</p>
          <button
            type="button"
            className={`${ui.button} ${ui.primary} ${ui.block}`}
            onClick={() => void auth.signIn(returnTo)}
          >
            {strings.auth.signInButton}
          </button>
        </>
      )}
    </AuthScreen>
  );
}
