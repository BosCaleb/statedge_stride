import type { DecodedKeypoints } from '@stride/analysis/skp1';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import { formatDisplayDate } from '@stride/shared/dates';
import { useRef, useState, type RefObject } from 'react';
import { useSearchParams } from 'react-router';
import shell from '../../app/shell.module.css';
import { ClipPicker } from '../../components/ClipPicker';
import { ConfidenceBadge } from '../../components/ConfidenceBadge';
import form from '../../components/form.module.css';
import { FrameCanvas, SPEEDS, type FrameCanvasHandle } from '../../components/FrameCanvas';
import { unitLabel } from '../../components/MetricCard';
import { ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { strings } from '../../lib/strings';
import { useAthlete } from '../athletes/athleteData';
import { useAthleteHistory } from '../history/historyData';
import { TrendSection } from '../history/HistorySection';
import { useAnalysisSource, type AnalysisSource } from '../results/analysisSource';
import { formatValue } from '../results/metricFormat';
import { useClipFile } from '../results/useClipFile';
import { useKeypoints } from '../results/useKeypoints';
import { useSession } from '../sessions/sessionData';
import { comparisonCaveats, metricChanges } from './compareLogic';
import styles from './compare.module.css';

// /compare?a=<id>&b=<id>: two analyses of one athlete side by side, played in step from the
// first initial contact of each, the change in each measurement, and a trend.

const firstContact = (r: AnalysisResult) =>
  r.events.reduce((min, e) => Math.min(min, e.icFrame), Number.POSITIVE_INFINITY);

export function ComparePage() {
  const [params] = useSearchParams();
  const a = useAnalysisSource(params.get('a') ?? '');
  const b = useAnalysisSource(params.get('b') ?? '');
  if (a.status === 'loading' || b.status === 'loading') return <LoadingState />;
  if (a.status === 'offline' || b.status === 'offline')
    return <ErrorState title={strings.errors.offline} />;
  if (a.status === 'missing' || b.status === 'missing')
    return <ErrorState title={strings.compare.missing} />;
  if (a.source.athleteId !== b.source.athleteId)
    return <ErrorState title={strings.compare.differentAthletes} />;
  return <Comparison pair={[a.source, b.source]} />;
}

/** The day the run was filmed: its session's date, or the day it was analysed. */
function useRunDate(source: AnalysisSource): string {
  const session = useSession(source.sessionId);
  return session.data?.session.sessionDate ?? source.createdAt.slice(0, 10);
}

function Comparison({ pair }: { pair: [AnalysisSource, AnalysisSource] }) {
  const dates = [useRunDate(pair[0]), useRunDate(pair[1])] as const;
  const swap =
    dates[1] < dates[0] || (dates[1] === dates[0] && pair[1].createdAt < pair[0].createdAt);
  const [before, after] = swap ? [pair[1], pair[0]] : pair;
  const [beforeDate, afterDate] = swap ? [dates[1], dates[0]] : dates;
  const athlete = useAthlete(before.athleteId);
  const history = useAthleteHistory(before.athleteId);
  const players = [useRef<FrameCanvasHandle>(null), useRef<FrameCanvasHandle>(null)] as const;
  const [speed, setSpeed] = useState<number>(SPEEDS[0]);
  const [playing, setPlaying] = useState(false);
  const caveats = comparisonCaveats(before.result, after.result);
  const rows = metricChanges(before.result, after.result);
  const starts = [firstContact(before.result), firstContact(after.result)].map((f) =>
    Number.isFinite(f) ? f : 0,
  );

  const toContact = () => {
    players.forEach((p, i) => p.current?.seek(starts[i] ?? 0));
    setPlaying(false);
  };
  const step = (delta: number) => {
    players.forEach((p) => p.current?.seek((p.current.frame() ?? 0) + delta));
    setPlaying(false);
  };
  const togglePlay = () => {
    if (playing) {
      players.forEach((p) => p.current?.pause());
      setPlaying(false);
      return;
    }
    // Start both from their first contact, so that the passes run in step.
    players.forEach((p, i) => p.current?.seek(starts[i] ?? 0));
    players.forEach((p) => p.current?.play(speed));
    setPlaying(true);
  };

  return (
    <div className={shell.page}>
      <h1>{strings.compare.title}</h1>
      {athlete.data ? (
        <p className={styles.lead}>
          {athlete.data.firstName} {athlete.data.lastName}
        </p>
      ) : null}

      {caveats.length > 0 ? (
        <section className={ui.notice} aria-labelledby="caveats-heading">
          <h2 id="caveats-heading" className={styles.caveatsTitle}>
            {strings.compare.caveatsTitle}
          </h2>
          <ul className={styles.caveats}>
            {caveats.map((c) => (
              <li key={c}>{strings.compare.caveats[c]}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.players}>
        <ComparePlayer
          source={before}
          label={`${strings.compare.earlier}, ${formatDisplayDate(beforeDate)}`}
          start={starts[0] ?? 0}
          handle={players[0]}
        />
        <ComparePlayer
          source={after}
          label={`${strings.compare.later}, ${formatDisplayDate(afterDate)}`}
          start={starts[1] ?? 0}
          handle={players[1]}
        />
      </div>
      <p className={form.hint}>{strings.compare.syncNote}</p>
      <div className={styles.controls}>
        <button type="button" className={`${ui.button} ${ui.primary}`} onClick={togglePlay}>
          {playing ? strings.compare.pauseBoth : strings.compare.playBoth}
        </button>
        <div className={styles.speeds} role="group" aria-label={strings.results.speedLabel}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={`${ui.button} ${speed === s ? ui.secondary : ui.quiet}`}
              aria-pressed={speed === s}
              onClick={() => setSpeed(s)}
            >
              {strings.results.speed(s)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`${ui.button} ${ui.quiet}`}
          aria-label={strings.compare.stepBack}
          onClick={() => step(-1)}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.quiet}`}
          aria-label={strings.compare.stepForward}
          onClick={() => step(1)}
        >
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" className={`${ui.button} ${ui.quiet}`} onClick={toContact}>
          {strings.compare.toContact}
        </button>
      </div>

      <section className={styles.section} aria-labelledby="changes-heading">
        <h2 id="changes-heading">{strings.compare.tableTitle}</h2>
        {/* Scrolls sideways on a phone, so it takes keyboard focus. */}
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="group"
          aria-labelledby="changes-heading"
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{strings.compare.metric}</th>
                <th scope="col">{strings.compare.earlier}</th>
                <th scope="col">{strings.compare.later}</th>
                <th scope="col">{strings.compare.change}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{strings.metrics.names[r.id]}</th>
                  {[r.before, r.after].map((m, i) => (
                    <td key={i}>
                      {m ? (
                        <>
                          <span className={styles.value}>
                            {formatValue(m.value, m.unit)} {unitLabel(m.unit)}
                          </span>
                          <ConfidenceBadge confidence={m.confidence} />
                        </>
                      ) : (
                        <span className={styles.muted}>{strings.compare.notMeasured}</span>
                      )}
                    </td>
                  ))}
                  <td>
                    {r.change !== null && r.direction ? (
                      <>
                        <span className={styles.value}>
                          {strings.compare.changeValue(
                            r.change > 0 ? '+' : '',
                            formatValue(r.change, r.unit),
                            unitLabel(r.unit),
                          )}
                        </span>
                        <span className={styles.muted}>
                          {strings.compare.directions[r.direction]}
                        </span>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {history.rows.length > 0 ? <TrendSection rows={history.rows} /> : null}
    </div>
  );
}

function ComparePlayer({
  source,
  label,
  start,
  handle,
}: {
  source: AnalysisSource;
  label: string;
  start: number;
  handle: RefObject<FrameCanvasHandle>;
}) {
  const { state, pick } = useClipFile(source.clip);
  const keypoints: DecodedKeypoints | null = useKeypoints(source.keypoints);
  return (
    <figure className={styles.player}>
      <figcaption className={styles.caption}>{label}</figcaption>
      {state.kind === 'ready' && keypoints ? (
        <FrameCanvas
          ref={handle}
          file={state.file}
          keypoints={keypoints}
          initialFrame={start}
          onFrame={() => undefined}
          controls={false}
          label={label}
        />
      ) : state.kind === 'missing' && source.clip?.fingerprint ? (
        <div className={styles.missing}>
          <p>{strings.compare.noClip}</p>
          <ClipPicker
            label={strings.results.pickOriginal}
            multiple={false}
            onPick={(files) => {
              const [f] = files;
              if (f) void pick(f);
            }}
          />
        </div>
      ) : state.kind === 'missing' ? (
        <p className={styles.muted}>{strings.compare.noClip}</p>
      ) : (
        <LoadingState />
      )}
    </figure>
  );
}
