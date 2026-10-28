import { Link } from 'react-router';
import { EmptyState } from '../../components/States';
import { strings } from '../../lib/strings';
import ui from '../../components/ui.module.css';

export function NotFoundPage() {
  return (
    <main>
      <EmptyState
        title={strings.errors.notFoundTitle}
        body={strings.errors.notFoundBody}
        action={
          <Link to="/" className={`${ui.button} ${ui.primary}`}>
            {strings.errors.goHome}
          </Link>
        }
      />
    </main>
  );
}
