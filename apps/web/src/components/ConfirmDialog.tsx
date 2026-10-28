import { useEffect, useId, useRef, type ReactNode } from 'react';
import { strings } from '../lib/strings';
import ui from './ui.module.css';

/** A modal confirmation built on <dialog>, which traps focus and closes on Escape. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = strings.common.confirm,
  danger = false,
  confirmDisabled = false,
  hideCancel = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  /** For a notice that only needs acknowledging. */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={ui.dialog} aria-labelledby={titleId} onCancel={onCancel}>
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className={ui.dialogActions}>
        {hideCancel ? null : (
          <button type="button" className={`${ui.button} ${ui.quiet}`} onClick={onCancel}>
            {strings.common.cancel}
          </button>
        )}
        <button
          type="button"
          className={`${ui.button} ${danger ? ui.danger : ui.primary}`}
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
