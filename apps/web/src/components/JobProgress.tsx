import { STAGES, type Stage } from '@stride/shared/enums';
import { useEffect, useId, useRef, useState } from 'react';
import { strings } from '../lib/strings';
import styles from './frames.module.css';
import ui from './ui.module.css';

/** One bar for the whole job, mostly by frame while the athlete is tracked. */
export function overallProgress(stage: Stage, fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  switch (stage) {
    case 'reading':
      return 0.02 * f;
    case 'finding':
      return 0.02 + 0.93 * f;
    case 'detecting':
      return 0.95 + 0.04 * f;
    case 'calculating':
      return 0.99 + 0.01 * f;
  }
}

/** Elapsed time as m:ss. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The full-screen analysis view: stage names, a progress bar, elapsed time and Cancel. Says so
 * when the job paused because Stride went to the background.
 */
export function JobProgress({
  stage,
  fraction,
  startedAt,
  paused,
  wasPaused,
  onCancel,
}: {
  stage: Stage;
  fraction: number;
  startedAt: number;
  paused: boolean;
  wasPaused: boolean;
  onCancel: () => void;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    heading.current?.focus();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = STAGES.indexOf(stage);
  const overall = overallProgress(stage, fraction);

  return (
    <div className={styles.job} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={styles.jobInner}>
        <h1 id={titleId} ref={heading} tabIndex={-1}>
          {strings.job.title}
        </h1>
        <ol className={styles.stages}>
          {STAGES.map((s, i) => (
            <li
              key={s}
              className={`${styles.stage} ${i < current ? styles.stageDone : ''} ${i === current ? styles.stageCurrent : ''}`}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className={styles.stageMark} aria-hidden="true">
                {i < current ? '✓' : i + 1}
              </span>
              {strings.job.stages[s]}
            </li>
          ))}
        </ol>
        <progress
          className={styles.progress}
          max={100}
          value={Math.round(overall * 100)}
          aria-label={strings.job.progressLabel(strings.job.stages[stage])}
        />
        <p className={styles.elapsed}>{strings.job.elapsed(formatElapsed(now - startedAt))}</p>
        {paused ? (
          <p className={ui.notice} role="status">
            {strings.job.paused}
          </p>
        ) : (
          <p role="status">{wasPaused ? strings.job.resumed : strings.job.keepOpen}</p>
        )}
        <div>
          <button type="button" className={`${ui.button} ${ui.quiet}`} onClick={onCancel}>
            {strings.job.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
