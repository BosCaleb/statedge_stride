import type { StanceEvent } from '@stride/shared/analysisResult';
import type { Side } from '@stride/shared/enums';
import { useId } from 'react';
import { strings } from '../lib/strings';
import styles from './metrics.module.css';

interface Marker {
  side: Side;
  kind: 'ic' | 'to';
  frame: number;
}

/**
 * Initial contacts and toe-offs along the clip: left above, right below, each labelled L or R,
 * filled for contact and outlined for toe-off, so colour is never the only signal. Tapping a
 * marker jumps to its frame.
 */
export function EventTimeline({
  events,
  frameCount,
  currentFrame,
  onJump,
}: {
  events: readonly StanceEvent[];
  frameCount: number;
  currentFrame: number;
  onJump: (frame: number) => void;
}) {
  const id = useId();
  const markers: Marker[] = events.flatMap((e) => [
    { side: e.side, kind: 'ic' as const, frame: e.icFrame },
    ...(e.toFrame !== null ? [{ side: e.side, kind: 'to' as const, frame: e.toFrame }] : []),
  ]);
  const at = (frame: number) =>
    `${(Math.min(frameCount - 1, Math.max(0, frame)) / Math.max(1, frameCount - 1)) * 100}%`;
  return (
    <div className={styles.timeline}>
      <div className={styles.track} role="group" aria-labelledby={id}>
        <span id={id} className="visuallyHidden">
          {strings.results.timeline}
        </span>
        <span className={styles.cursor} style={{ left: at(currentFrame) }} aria-hidden="true" />
        {markers.map((m) => (
          <button
            key={`${m.side}-${m.kind}-${m.frame}`}
            type="button"
            className={`${styles.marker} ${m.side === 'left' ? styles.markerLeft : styles.markerRight} ${m.kind === 'ic' ? styles.markerIc : styles.markerTo}`}
            style={{ left: at(m.frame) }}
            aria-label={strings.results.eventLabel(m.side, m.kind, m.frame + 1)}
            aria-current={m.frame === currentFrame ? 'true' : undefined}
            onClick={() => onJump(m.frame)}
          >
            <span aria-hidden="true">{m.side === 'left' ? 'L' : 'R'}</span>
          </button>
        ))}
      </div>
      <p className={styles.small}>{strings.results.timelineLegend}</p>
    </div>
  );
}
