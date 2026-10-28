import type { Athlete } from '@stride/shared/api/athletes';
import type { Note } from '@stride/shared/api/analyses';
import { formatDisplayDate } from '@stride/shared/dates';
import { shortDisplayName } from '@stride/shared/reportSnapshot';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import shell from '../../app/shell.module.css';
import { ClipPicker } from '../../components/ClipPicker';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EventTimeline } from '../../components/EventTimeline';
import form from '../../components/form.module.css';
import { FrameCanvas, type FrameCanvasHandle } from '../../components/FrameCanvas';
import { GateBanner } from '../../components/GateBanner';
import { ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import {
  localKeys,
  storeLocalResult,
  useLocalCalibrations,
  useLocalClips,
  useLocalResults,
} from '../../lib/local/localQueries';
import { localResults } from '../../lib/local/records';
import type { LocalResult } from '../../lib/local/records';
import { deleteThumbnails, KEY_FRAME_KINDS } from '../../lib/local/thumbnails';
import { needsAttention } from '../../lib/outbox/outbox';
import { useOutbox, useOutboxEntries } from '../../lib/outbox/OutboxProvider';
import { strings } from '../../lib/strings';
import { canAnalyse, useAthlete } from '../athletes/athleteData';
import { useSession } from '../sessions/sessionData';
import { useAnalysisSource, type AnalysisSource } from './analysisSource';
import { frameAngles } from './frameAngles';
import { GateStatusBadge } from './GateStatusBadge';
import { AngleTable, KeyFrameButton, MetricsSection } from './ResultParts';
import styles from './results.module.css';
import { analysisKey, historyKey, useDeleteNote, useSaveNote, useSaveResult } from './saveResult';
import { useClipFile } from './useClipFile';
import { useKeypoints } from './useKeypoints';

// /analyses/:id: the result viewer. Clip and skeleton, event timeline, angles at the current
// frame, the three key frames, the gate banner, the measurements in two groups, notes, and
// saving. Works for a result on this phone and for one saved by any coach of the organisation.

export function ResultPage() {
  const { id = '' } = useParams();
  const state = useAnalysisSource(id);
  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'offline') return <ErrorState title={strings.errors.offline} />;
  if (state.status === 'missing') return <ErrorState title={strings.results.notFound} />;
  return <ResultView source={state.source} />;
}

function ResultView({ source }: { source: AnalysisSource }) {
  const { result } = source;
  const { state: fileState, pick } = useClipFile(source.clip);
  const keypoints = useKeypoints(source.keypoints);
  const athlete = useAthlete(source.athleteId);
  const session = useSession(source.sessionId);
  const player = useRef<FrameCanvasHandle>(null);
  const initialFrame =
    result.keyFrames?.icFrame ?? result.events[0]?.icFrame ?? source.local?.roiFrame ?? 0;
  const [frame, setFrame] = useState(initialFrame);
  const [wrongFile, setWrongFile] = useState(false);
  const minVisibility = result.configSnapshot.landmarks.minVisibility;
  const angles = frameAngles(keypoints?.frames[frame], result.direction, minVisibility);
  const name = athlete.data
    ? `${athlete.data.firstName} ${athlete.data.lastName}`
    : strings.sessions.unknownAthlete;
  const s = session.data?.session;
  // The note typed before saving: held here so that Save sends what is in the box.
  const [draft, setDraft] = useState(source.local?.noteDraft ?? '');
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
            formatDisplayDate(s?.sessionDate ?? source.createdAt),
            strings.sessions.modes[result.mode],
          )}
        </p>
        <GateStatusBadge status={result.gate.status} />
      </header>

      {fileState.kind === 'ready' && keypoints ? (
        <FrameCanvas
          ref={player}
          file={fileState.file}
          keypoints={keypoints}
          initialFrame={initialFrame}
          onFrame={setFrame}
        />
      ) : fileState.kind === 'missing' && source.clip?.fingerprint ? (
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
      ) : fileState.kind === 'loading' || (source.keypoints && !keypoints) ? (
        <LoadingState />
      ) : null}

      {keypoints ? (
        <EventTimeline
          events={result.events}
          frameCount={keypoints.frames.length}
          currentFrame={frame}
          onJump={jump}
        />
      ) : null}

      {keypoints ? (
        <section className={styles.section} aria-labelledby="angles-heading">
          <h2 id="angles-heading">{strings.results.anglesTitle}</h2>
          <AngleTable angles={angles} />
        </section>
      ) : null}

      {result.keyFrames && source.local ? (
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
                    analysisId={source.id}
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
      <MetricsSection result={result} />

      {source.saved ? (
        <SavedNotes source={source} athlete={athlete.data} />
      ) : source.local ? (
        <DraftNote record={source.local} text={draft} onChange={setDraft} />
      ) : null}
      <SaveBar source={source} athlete={athlete.data} draft={draft} />
    </div>
  );
}

/**
 * Whether this analysis has writes waiting in the outbox, and whether one of them, or a write
 * one waits for (its clip or calibration), failed.
 */
function useSaveState(analysisId: string): 'none' | 'waiting' | 'failed' {
  const all = useOutboxEntries();
  const entries = all.filter(
    (e) =>
      e.resource?.id === analysisId ||
      (e.body !== null &&
        typeof e.body === 'object' &&
        'analysisId' in e.body &&
        e.body.analysisId === analysisId),
  );
  if (entries.some((e) => needsAttention(e, all))) return 'failed';
  return entries.length > 0 ? 'waiting' : 'none';
}

function SaveBar({
  source,
  athlete,
  draft,
}: {
  source: AnalysisSource;
  athlete: Athlete | undefined;
  draft: string;
}) {
  const save = useSaveResult();
  const outbox = useOutbox();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clips = useLocalClips();
  const calibrations = useLocalCalibrations();
  const results = useLocalResults();
  const saveState = useSaveState(source.id);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const local = source.local;
  const consented = canAnalyse(athlete);

  const runSave = async () => {
    const clip = clips.data?.find((c) => c.id === source.clipId);
    if (!local || !clip || !athlete) return;
    setBusy(true);
    // The newest saved result of the same clip is the one this replaces.
    const previous = (results.data ?? [])
      .filter((r) => r.clipId === local.clipId && r.id !== local.id && r.savedAt !== null)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    await save({
      record: { ...local, noteDraft: draft.slice(0, 2000) },
      clip,
      calibration: calibrations.data?.find((c) => c.id === local.calibrationId) ?? null,
      athlete,
      supersedes: previous?.id ?? null,
    });
    setBusy(false);
  };

  const remove = async () => {
    setConfirming(false);
    if (source.saved) {
      await outbox.enqueue({
        route: 'deleteAnalysis',
        params: { id: source.id },
        needs: [{ type: 'analysis', id: source.id }],
        label: strings.results.outboxDeleteLabel,
        invalidates: [[...historyKey(source.athleteId)], ['session', source.sessionId]],
      });
      void outbox.flush();
      queryClient.removeQueries({ queryKey: analysisKey(source.id) });
    }
    if (local) {
      await localResults.delete(local.id);
      await deleteThumbnails(local.id);
      await queryClient.invalidateQueries({ queryKey: localKeys.results });
    }
    void navigate(`/sessions/${source.sessionId}`, { replace: true });
  };

  return (
    <section className={styles.section} aria-labelledby="save-heading">
      <h2 id="save-heading" className="visuallyHidden">
        {strings.results.saveTitle}
      </h2>
      {!source.saved ? (
        <>
          {!consented ? (
            <p className={ui.notice}>
              {strings.results.saveNeedsConsent}{' '}
              {athlete ? (
                <Link to={`/athletes/${athlete.id}/consent`}>{strings.athlete.recordConsent}</Link>
              ) : null}
            </p>
          ) : null}
          <p className={styles.subtitle}>{strings.results.notSaved}</p>
        </>
      ) : (
        <p role="status" className={styles.subtitle}>
          {saveState === 'failed'
            ? strings.results.saveFailed
            : saveState === 'waiting'
              ? strings.results.saveWaiting
              : strings.results.saved}
        </p>
      )}
      <div className={form.actions}>
        {!source.saved ? (
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={!consented || busy || !local}
            onClick={() => void runSave()}
          >
            {strings.results.save}
          </button>
        ) : null}
        <button
          type="button"
          className={`${ui.button} ${ui.quiet}`}
          onClick={() => setConfirming(true)}
        >
          {source.saved ? strings.results.delete : strings.results.discard}
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={source.saved ? strings.results.deleteTitle : strings.results.discardTitle}
        confirmLabel={source.saved ? strings.results.delete : strings.results.discard}
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => void remove()}
      >
        <p>{source.saved ? strings.results.deleteBody : strings.results.discardBody}</p>
      </ConfirmDialog>
    </section>
  );
}

/** Before saving: a note kept on this phone with the result, saved with it. */
function DraftNote({
  record,
  text,
  onChange,
}: {
  record: LocalResult;
  text: string;
  onChange: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const keep = () => {
    if (text !== record.noteDraft)
      void storeLocalResult(queryClient, { ...record, noteDraft: text.slice(0, 2000) });
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
          maxLength={2000}
          aria-describedby="result-notes-hint"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={keep}
        />
        <p id="result-notes-hint" className={form.hint}>
          {strings.results.notesHint}
        </p>
      </div>
    </section>
  );
}

/** After saving: the organisation's notes on this analysis, added and deleted through the outbox. */
function SavedNotes({ source, athlete }: { source: AnalysisSource; athlete: Athlete | undefined }) {
  const saveNote = useSaveNote();
  const deleteNote = useDeleteNote();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const label = strings.results.outboxNoteLabel(
    athlete ? shortDisplayName(athlete.firstName, athlete.lastName) : '',
  );
  // Notes written on this phone show at once, before the server has them.
  const pending = useOutboxEntries()
    .filter((e) => e.route === 'putNote' && e.params?.id)
    .map((e) => ({ id: e.params?.id ?? '', body: e.body }))
    .filter(
      (n): n is { id: string; body: { analysisId: string; body: string } } =>
        typeof n.body === 'object' &&
        n.body !== null &&
        'analysisId' in n.body &&
        n.body.analysisId === source.id,
    );
  const deleting = new Set(
    useOutboxEntries()
      .filter((e) => e.route === 'deleteNote')
      .map((e) => e.params?.id),
  );
  const shown: Pick<Note, 'id' | 'body'>[] = [
    ...source.notes.filter((n) => !pending.some((p) => p.id === n.id)),
    ...pending.map((p) => ({ id: p.id, body: p.body.body })),
  ].filter((n) => !deleting.has(n.id));

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    await saveNote(source.id, crypto.randomUUID(), body, label);
    await queryClient.invalidateQueries({ queryKey: analysisKey(source.id) });
  };

  return (
    <section className={styles.section} aria-labelledby="notes-heading">
      <h2 id="notes-heading">{strings.results.notesTitle}</h2>
      {shown.length === 0 ? <p className={form.hint}>{strings.results.noNotes}</p> : null}
      <ul className={styles.notes}>
        {shown.map((n) => (
          <li key={n.id} className={styles.note}>
            <p>{n.body}</p>
            <button
              type="button"
              className={`${ui.button} ${ui.quiet}`}
              onClick={() => void deleteNote(source.id, n.id, label)}
            >
              {strings.results.deleteNote}
            </button>
          </li>
        ))}
      </ul>
      <div className={form.field}>
        <label className={form.label} htmlFor="result-new-note">
          {strings.results.addNote}
        </label>
        <textarea
          id="result-new-note"
          className={form.input}
          rows={3}
          maxLength={2000}
          aria-describedby="result-new-note-hint"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p id="result-new-note-hint" className={form.hint}>
          {strings.results.newNoteHint}
        </p>
      </div>
      <div className={form.actions}>
        <button
          type="button"
          className={`${ui.button} ${ui.secondary}`}
          disabled={!text.trim()}
          onClick={() => void add()}
        >
          {strings.results.addNoteButton}
        </button>
      </div>
    </section>
  );
}
