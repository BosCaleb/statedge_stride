import { useId } from 'react';
import { strings } from '../lib/strings';
import styles from './frames.module.css';
import ui from './ui.module.css';

/** Moves through a clip frame by frame: a slider and buttons for one and ten frames. */
export function FrameScrubber({
  index,
  count,
  timeSec,
  onChange,
}: {
  /** Zero-based frame index. */
  index: number;
  count: number;
  timeSec: number;
  onChange: (index: number) => void;
}) {
  const id = useId();
  const go = (i: number) => onChange(Math.min(count - 1, Math.max(0, i)));
  const position = strings.frames.position(index + 1, count, timeSec.toFixed(3));
  const step = (label: string, to: number, arrow: string) => (
    <button
      type="button"
      className={`${ui.button} ${ui.quiet}`}
      aria-label={label}
      disabled={to < 0 || to > count - 1}
      onClick={() => go(to)}
    >
      <span aria-hidden="true">{arrow}</span>
    </button>
  );
  return (
    <div className={styles.scrubber}>
      <label htmlFor={id} className="visuallyHidden">
        {strings.frames.slider}
      </label>
      <input
        id={id}
        className={styles.range}
        type="range"
        min={0}
        max={Math.max(0, count - 1)}
        step={1}
        value={index}
        aria-valuetext={position}
        onChange={(e) => go(Number(e.target.value))}
      />
      <p className={styles.position}>{position}</p>
      <div className={styles.steps}>
        {step(strings.frames.back10, index - 10, '«')}
        {step(strings.frames.previous, index - 1, '‹')}
        {step(strings.frames.next, index + 1, '›')}
        {step(strings.frames.forward10, index + 10, '»')}
      </div>
    </div>
  );
}
