import type { ReactNode } from 'react';
import { strings } from '../lib/strings';
import styles from './clip.module.css';

/** What the container says about a clip, read without decoding it. */
export interface ClipFactsView {
  fileName: string;
  widthPx: number;
  heightPx: number;
  durationSec: number;
  codec: string;
  /** From the frame timestamps in the file; null when the file has too few frames. */
  fileFps: number | null;
  irregularShare: number | null;
}

/** A readable name for a codec string such as avc1.640028. */
export function codecName(codec: string): string {
  const tag = codec.slice(0, 4).toLowerCase();
  if (tag === 'avc1' || tag === 'avc3') return 'H.264';
  if (tag === 'hvc1' || tag === 'hev1') return 'HEVC (H.265)';
  if (tag === 'vp09') return 'VP9';
  if (tag === 'av01') return 'AV1';
  return codec || strings.clips.unknown;
}

/** Below this the file plays slower than slow motion was filmed, or is normal video. */
const RETIMED_BELOW_FPS = 100;

/**
 * The real frame rate, resolution, length, codec and frame timing of one clip, with room for
 * the choices made about it (role, athlete) as children.
 */
export function ClipInfoCard({
  facts,
  label,
  children,
}: {
  facts: ClipFactsView;
  /** Shown above the file name, for example "Calibration clip". */
  label?: string;
  children?: ReactNode;
}) {
  const irregular = facts.irregularShare;
  return (
    <article className={styles.card} aria-label={facts.fileName}>
      <header>
        {label ? <p className={styles.label}>{label}</p> : null}
        <h3 className={styles.name}>{facts.fileName}</h3>
      </header>
      <dl className={styles.facts}>
        <div>
          <dt>{strings.clips.frameRate}</dt>
          <dd>
            {facts.fileFps !== null ? strings.clips.fps(facts.fileFps) : strings.clips.unknown}
          </dd>
        </div>
        <div>
          <dt>{strings.clips.resolution}</dt>
          <dd>{strings.clips.size(facts.widthPx, facts.heightPx)}</dd>
        </div>
        <div>
          <dt>{strings.clips.duration}</dt>
          <dd>{strings.clips.seconds(facts.durationSec)}</dd>
        </div>
        <div>
          <dt>{strings.clips.codec}</dt>
          <dd>{codecName(facts.codec)}</dd>
        </div>
        <div>
          <dt>{strings.clips.timing}</dt>
          <dd>
            {irregular === null || !Number.isFinite(irregular)
              ? strings.clips.unknown
              : irregular === 0
                ? strings.clips.timingRegular
                : strings.clips.timingIrregular(`${(irregular * 100).toFixed(1)}%`)}
          </dd>
        </div>
      </dl>
      {facts.fileFps !== null && facts.fileFps < RETIMED_BELOW_FPS ? (
        <p className={styles.note}>{strings.clips.retimed}</p>
      ) : null}
      {children}
    </article>
  );
}
