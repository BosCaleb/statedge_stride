import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { strings } from '../lib/strings';
import { supportCode } from '../lib/supportCode';
import ui from '../components/ui.module.css';
import styles from './shell.module.css';

// Errors show Reload and "Copy a support code", never details. The support code goes to the
// console (and, from M6, to telemetry) so that StatEdge can match it to the error.

function CrashScreen({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.bare}>
      <div className={`${ui.card} ${styles.bareCard}`} role="alert">
        <h1>{strings.errors.title}</h1>
        <p>{strings.errors.body}</p>
        <div className={ui.dialogActions}>
          <button
            type="button"
            className={`${ui.button} ${ui.quiet}`}
            onClick={() => {
              void navigator.clipboard?.writeText(code).then(() => setCopied(true));
            }}
          >
            {copied ? strings.errors.supportCodeCopied : strings.errors.copySupportCode}
          </button>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            onClick={() => window.location.reload()}
          >
            {strings.errors.reload}
          </button>
        </div>
      </div>
    </div>
  );
}

function report(error: unknown): string {
  const code = supportCode();
  console.error(`support code ${code}`, error);
  return code;
}

/** The outermost boundary, for anything that escapes the router. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { code: string | null }> {
  override state = { code: null as string | null };

  static getDerivedStateFromError(): { code: string } {
    return { code: supportCode() };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`support code ${this.state.code ?? ''}`, error, info.componentStack);
  }

  override render() {
    return this.state.code ? <CrashScreen code={this.state.code} /> : this.props.children;
  }
}

/** The router's error element: unknown paths and errors thrown while rendering a route. */
export function RouteError() {
  const error = useRouteError();
  const [code] = useState(() =>
    isRouteErrorResponse(error) && error.status === 404 ? null : report(error),
  );
  if (code === null) {
    return (
      <div className={styles.bare}>
        <div className={`${ui.card} ${styles.bareCard}`}>
          <h1>{strings.errors.notFoundTitle}</h1>
          <p>{strings.errors.notFoundBody}</p>
          <Link to="/" className={`${ui.button} ${ui.primary}`}>
            {strings.errors.goHome}
          </Link>
        </div>
      </div>
    );
  }
  return <CrashScreen code={code} />;
}
