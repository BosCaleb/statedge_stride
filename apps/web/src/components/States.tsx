import type { ReactNode } from 'react';
import { strings } from '../lib/strings';
import ui from './ui.module.css';
import { StatEdgeLoader } from './StatEdgeLoader';

// Every list and screen has loading, empty and error states.

export function LoadingState({ label = strings.errors.loading }: { label?: string }) {
  return <StatEdgeLoader label={label} />;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className={ui.state}>
      <h2 className={ui.stateTitle}>{title}</h2>
      {body ? <p className={ui.stateBody}>{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
  action,
}: {
  title: string;
  body?: string;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  return (
    <div className={ui.state} role="alert">
      <h2 className={ui.stateTitle}>{title}</h2>
      {body ? <p className={ui.stateBody}>{body}</p> : null}
      {onRetry ? (
        <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onRetry}>
          {strings.errors.tryAgain}
        </button>
      ) : null}
      {action}
    </div>
  );
}
