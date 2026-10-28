import { decodeSkp1, type DecodedKeypoints } from '@stride/analysis/skp1';
import type { MetricResult } from '@stride/shared/analysisResult';
import { formatDisplayDate } from '@stride/shared/dates';
import type { Side } from '@stride/shared/enums';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import shell from '../../app/shell.module.css';
import { ClipPicker } from '../../components/ClipPicker';
import { EventTimeline } from '../../components/EventTimeline';
import form from '../../components/form.module.css';
import { FrameCanvas, type FrameCanvasHandle } from '../../components/FrameCanvas';
import { GateBanner } from '../../components/GateBanner';
import { MetricCard, reasonText } from '../../components/MetricCard';
import { ErrorState, LoadingState } from '../../components/States';
import { storeLocalResult, useLocalClips, useLocalResults } from '../../lib/local/localQueries';
import type { LocalResult } from '../../lib/local/records';
import { getThumbnail, KEY_FRAME_KINDS, type KeyFrameKind } from '../../lib/local/thumbnails';
import { strings } from '../../lib/strings';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useAthlete } from '../athletes/athleteData';
import { useSession } from '../sessions/sessionData';
import { frameAngles } from './frameAngles';
import { GateStatusBadge } from './GateStatusBadge';
import { groupMetrics } from './metricFormat';
import styles from './results.module.css';
import { useClipFile } from './useClipFile';

// /analyses/:id: the result viewer. Clip and skeleton, event timeline, angles at the current
// frame, the three key frames, the gate banner, the measurements in two groups, and notes.

async function decodeKeypoints(blob: Blob): Promise<DecodedKeypoints | null> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const decoded = decodeSkp1(bytes);
  return decoded.ok ? decoded.value : null;
}

function useKeypoints(blob: Blob | undefined): DecodedKeypoints | null {
  const [keypoints, setKeypoints] = useState<DecodedKeypoints | null>(null);
  useEffect(() => {
    if (!blob) return;
    let live = true;
    void decodeKeypoints(blob).then((k) => {
      if (live) setKeypoints(k);
    });
    return () => {
      live = false;
    };
  }, [blob]);
  return keypoints;
}

export function ResultPage() {
  const { id = '' } = useParams();
  const results = useLocalResults();
  const local = results.data?.find((r) => r.id === id);
  if (results.isPending) return <LoadingState />;
  if (!local) return <ErrorState title={strings.results.notFound} />;
  return <LocalResultView record={local} />;
}

function LocalResultView({ record }: { record: LocalResult }) {
  const { result } = record;
  const clips = useLocalClips();
  const clip = clips.data?.find((c) => c.id === record.clipId);
  const { state: fileState, pick } = useClipFile(clip);
  const keypoints = useKeypoints(record.keypoints);
  const athlete = useAthlete(record.athleteId);
  const session = useSession(record.sessionId);
  const player = useRef<FrameCanvasHandle>(null);
  const initialFrame = result.keyFrames?.icFrame ?? result.events[0]?.icFrame ?? record.roiFrame;
  const [frame, setFrame] = useState(initialFrame);
  const [wrongFile, setWrongFile] = useState(false);
  const groups = useMemo(() => groupMetrics(result), [result]);
  const minVisibility = result.configSnapshot.landmarks.minVisibility;
  const angles = frameAngles(keypoints?.frames[frame], result.direction, minVisibility);
  const name = athlete.data
    ? `${athlete.data.firstName} ${athlete.data.lastName}`
    : strings.sessions.unknownAthlete;
  const s = session.data?.session;
  const jump = (f: number) => {
    setFrame(f);
    player.current?.seek(f);
  };

  return (
    <div className={shell.page}>
      <header className={styles.header}>
        <h1>{strings.results.title(name)}</h1>
        <p className={styles.subtitle}>
          {strings.results.subtitle(
            formatDisplayDate(s?.sessionDate ?? record.createdAt),
            strings.sessions.modes[result.mode],
          )}
        </p>
        <GateStatusBadge status={result.gate.status} />
        {record.savedAt ? null : <p className={styles.subtitle}>{strings.results.notSaved}</p>}
      </header>

      {fileState.kind === 'ready' && keypoints ? (
        <FrameCanvas
          ref={player}
          file={fileState.file}
          keypoints={keypoints}
          initialFrame={initialFrame}
          onFrame={setFrame}
        />
      ) : fileState.kind === 'missing' ? (
        <section className={styles.section} aria-labelledby="pick-heading">
          <h2 id="pick-heading">{strings.results.pickOriginalTitle}</h2>
          <p>{strings.results.pickOriginalHint}</p>
          <ClipPicker
            label={strings.results.pickOriginal}
            multiple={false}
            onPick={(files) => {
              const [f] = files;
              if (f) void pick(f).then((ok) => setWrongFile(!ok));
            }}
          />
          {wrongFile ? (
            <p className={form.error} role="alert">
              {strings.results.wrongFile}
            </p>
          ) : null}
        </section>
      ) : (
        <LoadingState />
      )}

      {keypoints ? (
        <EventTimeline
          events={result.events}
          frameCount={keypoints.frames.length}
          currentFrame={frame}
          onJump={jump}
        />
      ) : null}

      <section className={styles.section} aria-labelledby="angles-heading">
        <h2 id="angles-heading">{strings.results.anglesTitle}</h2>
        <AngleTable angles={angles} />
      </section>

      {result.keyFrames ? (
        <section className={styles.section} aria-labelledby="keyframes-heading">
          <h2 id="keyframes-heading">{strings.results.keyFramesTitle}</h2>
          <ul className={styles.keyFrames}>
            {KEY_FRAME_KINDS.map((kind) => {
              const kf = result.keyFrames;
              if (!kf) return null;
              const at = kind === 'ic' ? kf.icFrame : kind === 'mid' ? kf.midFrame : kf.toFrame;
              return (
                <li key={kind}>
                  <KeyFrameButton
                    analysisId={record.id}
                    kind={kind}
                    caption={strings.keyFrames.caption(kf.side, kind)}
                    onClick={() => jump(at)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <GateBanner result={result} />

      <section className={styles.section} aria-labelledby="metrics-heading">
        <h2 id="metrics-heading">{strings.results.measurementsTitle}</h2>
        {groups.primary.length + groups.secondary.length === 0 ? (
          <p>{strings.results.noMetrics}</p>
        ) : null}
        {[...groups.primary, ...groups.secondary].some((m) => m.sd !== undefined) ? (
          <p className={form.hint}>{strings.metrics.spreadHint}</p>
        ) : null}
        <MetricGroup title={strings.metrics.primary} metrics={groups.primary} />
        <MetricGroup title={strings.metrics.secondary} metrics={groups.secondary} />
        {groups.notMeasured.length > 0 ? (
          <div className={styles.notMeasured}>
            <h3>{strings.metrics.notMeasured}</h3>
            <ul>
              {groups.notMeasured.map((m) => (
                <li key={m.id}>
                  <strong>{strings.metrics.names[m.id]}</strong>
                  {m.reasons.length > 0 ? `: ${m.reasons.map(reasonText).join(' ')}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <NotesSection record={record} />
    </div>
  );
}

function MetricGroup({ title, metrics }: { title: string; metrics: MetricResult[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className={styles.group}>
      <h3>{title}</h3>
      <ul className={styles.cards}>
        {metrics.map((m) => (
          <li key={m.id}>
            <MetricCard metric={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AngleTable({ angles }: { angles: ReturnType<typeof frameAngles> }) {
  const fmt = (v: number | null) =>
    v === null ? strings.results.noAngle : strings.results.angle(v.toFixed(1));
  const rows: { label: string; left: number | null; right: number | null }[] = [
    { label: strings.results.angles.knee, ...angles.knee },
    { label: strings.results.angles.hip, ...angles.hip },
    { label: strings.results.angles.shin, ...angles.shin },
  ];
  const sides: Side[] = ['left', 'right'];
  return (
    <table className={styles.angles}>
      <thead>
        <tr>
          <td />
          {sides.map((side) => (
            <th key={side} scope="col">
              {strings.metrics.sides[side]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td>{fmt(r.left)}</td>
            <td>{fmt(r.right)}</td>
          </tr>
        ))}
        <tr>
          <th scope="row">{strings.results.angles.trunkLean}</th>
          <td colSpan={2}>{fmt(angles.trunkLean)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function KeyFrameButton({
  analysisId,
  kind,
  caption,
  onClick,
}: {
  analysisId: string;
  kind: KeyFrameKind;
  caption: string;
  onClick: () => void;
}) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let live = true;
    void getThumbnail(analysisId, kind).then((b) => {
      if (live) setBlob(b ?? null);
    });
    return () => {
      live = false;
    };
  }, [analysisId, kind]);
  const url = useObjectUrl(blob);
  return (
    <button
      type="button"
      className={styles.keyFrame}
      aria-label={strings.results.keyFrameButton(caption)}
      onClick={onClick}
    >
      {url ? <img src={url} alt="" /> : <span className={styles.keyFramePlaceholder} />}
      <span>{caption}</span>
    </button>
  );
}

function NotesSection({ record }: { record: LocalResult }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(record.noteDraft);
  const keep = () => {
    if (text !== record.noteDraft)
      void storeLocalResult(queryClient, { ...record, noteDraft: text.slice(0, 4000) });
  };
  return (
    <section className={styles.section} aria-labelledby="notes-heading">
      <h2 id="notes-heading">{strings.results.notesTitle}</h2>
      <div className={form.field}>
        <label className={form.label} htmlFor="result-notes">
          {strings.results.notesLabel}
        </label>
        <textarea
          id="result-notes"
          className={form.input}
          rows={4}
          maxLength={4000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={keep}
        />
        <p className={form.hint}>{strings.results.notesHint}</p>
      </div>
    </section>
  );
}
