import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/auth/authContext';
import { useOutboxStore } from '../lib/outbox/outboxStore';
import { strings } from '../lib/strings';
import { applyTheme, loadTheme, THEMES, type Theme } from '../lib/theme';
import ui from '../components/ui.module.css';
import styles from './shell.module.css';

const THEME_LABELS: Record<Theme, string> = {
  system: strings.account.themeSystem,
  light: strings.account.themeLight,
  dark: strings.account.themeDark,
};

/** The signed-in person, the light and dark switch, and sign-out. */
export function AccountMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [confirming, setConfirming] = useState(false);
  const unsaved = useOutboxStore((s) => s.pending + s.failed);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !ref.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const name = auth.account?.name ?? auth.account?.email ?? '';
  return (
    <div className={styles.account} ref={ref}>
      <button
        type="button"
        className={`${ui.button} ${ui.quiet}`}
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="account" />
        <span className="visuallyHidden">{strings.account.menu}</span>
      </button>
      {open ? (
        <div id="account-menu" className={styles.menu}>
          {name ? <p className={styles.menuName}>{strings.account.signedInAs(name)}</p> : null}
          <fieldset className={styles.themes}>
            <legend>{strings.account.themeLabel}</legend>
            {THEMES.map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  name="theme"
                  value={t}
                  checked={theme === t}
                  onChange={() => {
                    setTheme(t);
                    applyTheme(t);
                  }}
                />
                {THEME_LABELS[t]}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className={`${ui.button} ${ui.quiet} ${ui.block}`}
            onClick={() => (unsaved > 0 ? setConfirming(true) : void auth.signOut())}
          >
            {strings.account.signOut}
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={strings.account.unsavedTitle}
        confirmLabel={strings.account.signOutAnyway}
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void auth.signOut();
        }}
      >
        <p>{strings.account.unsavedBody(unsaved)}</p>
      </ConfirmDialog>
    </div>
  );
}
