import { useId } from 'react';
import styles from './clip.module.css';
import ui from './ui.module.css';

/**
 * Picks video files from the phone. A real file input (so the phone's own picker opens),
 * hidden behind a button-sized label that shows the focus ring when the input has it.
 */
export function ClipPicker({
  label,
  hint,
  multiple = true,
  onPick,
}: {
  label: string;
  hint?: string;
  multiple?: boolean;
  onPick: (files: File[]) => void;
}) {
  const id = useId();
  return (
    <div className={styles.picker}>
      <input
        id={id}
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        multiple={multiple}
        className={`visuallyHidden ${styles.pickerInput}`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) onPick(files);
        }}
      />
      <label htmlFor={id} className={`${ui.button} ${ui.primary} ${styles.pickerLabel}`}>
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
