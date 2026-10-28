import { defaultConfig } from '@stride/analysis/config';
import type { Athlete } from '@stride/shared/api/athletes';
import { formatDisplayDate } from '@stride/shared/dates';
import type { ClipRole } from '@stride/shared/enums';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { readClipFacts, type ClipFacts } from '../../analysis-runtime/clipFacts';
import type { ProbeError } from '../../analysis-runtime/probe';
import shell from '../../app/shell.module.css';
import { ClipInfoCard } from '../../components/ClipInfoCard';
import { ClipPicker } from '../../components/ClipPicker';
import { ConsentBadge } from '../../components/ConsentBadge';
import form from '../../components/form.module.css';
import { EmptyState, LoadingState } from '../../components/States';
import { StorageNotice } from '../../components/StorageNotice';
import ui from '../../components/ui.module.css';
import { keepCopy } from '../../lib/local/clipLibrary';
import { fingerprint } from '../../lib/local/fingerprint';
import {
  storeLocalCalibration,
  storeLocalClips,
  useLocalCalibrations,
} from '../../lib/local/localQueries';
import type { LocalCalibration, LocalClip } from '../../lib/local/records';
import { readPreference, writePreference } from '../../lib/storage';
import { strings } from '../../lib/strings';
import { useUiStore } from '../../stores/uiStore';
import { FPS_CHOICES, suggestedFps } from './importLogic';
import { canAnalyse, useAthletes } from '../athletes/athleteData';
import { CalibrationStep } from '../calibration/CalibrationStep';
import { useSession, useSessions } from '../sessions/sessionData';
import sessionStyles from '../sessions/sessions.module.css';
import styles from './import.module.css';

// /import: choose the session, pick a calibration clip and runs, say who is in each run, keep
// copies, calibrate, then go on to draw the athlete box and analyse each run. Works offline.

const KEEP_COPIES_PREF = 'stride.keepRunClipCopies';

interface Picked {
  key: string;
  file: File;
  state: 'reading' | 'ready' | 'unreadable';
  error?: ProbeError;
  facts?: ClipFacts;
  fingerprint?: string;
  role: ClipRole;
  athleteId: string | null;
  declaredFps: number;
}

export function ImportPage() {
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('session') ?? '';
  return (
    <div className={shell.page}>
      <h1>{strings.importClips.title}</h1>
      {sessionId ? (
        <ImportIntoSession sessionId={sessionId} onChangeSession={() => setParams({})} />
      ) : (
        <SessionChooser onChoose={(id) => setParams({ session: id })} />
      )}
    </div>
  );
}

function SessionChooser({ onChoose }: { onChoose: (id: string) => void }) {
  const sessions = useSessions();
  return (
    <section className={sessionStyles.section} aria-labelledby="session-step">
      <h2 id="session-step">{strings.importClips.chooseSession}</h2>
      <Link to="/sessions/new" className={`${ui.button} ${ui.primary}`}>
        {strings.importClips.newSession}
      </Link>
      {sessions.isPending ? (
        <LoadingState />
      ) : (sessions.data ?? []).length === 0 ? (
        <EmptyState title={strings.sessions.none} />
      ) : (
        <ul className={sessionStyles.list}>
          {(sessions.data ?? []).slice(0, 10).map((s) => (
            <li key={s.id}>
              <button type="button" className={sessionStyles.row} onClick={() => onChoose(s.id)}>
                <span className={sessionStyles.name}>{formatDisplayDate(s.sessionDate)}</span>
                <span className={sessionStyles.meta}>
                  {strings.sessions.details(strings.sessions.modes[s.mode], s.place)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Stage =
  | { kind: 'clips' }
  | { kind: 'calibrate'; clip: LocalClip; file: File; records: LocalClip[] }
  | { kind: 'done'; clips: LocalClip[]; copyFailed: boolean };

function ImportIntoSession({
  sessionId,
  onChangeSession,
}: {
  sessionId: string;
  onChangeSession: () => void;
}) {
  const session = useSession(sessionId);
  const athletes = useAthletes();
  const calibrations = useLocalCalibrations();
  const sessionAthletes = useUiStore((s) => s.sessionAthletes[sessionId]);
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [keepCopies, setKeepCopies] = useState(readPreference(KEEP_COPIES_PREF) !== 'false');
  const [stage, setStage] = useState<Stage>({ kind: 'clips' });
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const update = (key: string, change: Partial<Picked>) =>
    setPicked((list) => list.map((p) => (p.key === key ? { ...p, ...change } : p)));

  const onPick = (files: File[]) => {
    const only = sessionAthletes?.length === 1 ? (sessionAthletes[0] ?? null) : null;
    const added: Picked[] = files.map((file) => ({
      key: crypto.randomUUID(),
      file,
      state: 'reading',
      role: 'run',
      athleteId: only,
      declaredFps: 240,
    }));
    setPicked((list) => [...list, ...added]);
    setProblems([]);
    for (const p of added) {
      void (async () => {
        const facts = await readClipFacts(p.file, defaultConfig);
        if (!facts.ok) {
          update(p.key, { state: 'unreadable', error: facts.reason });
          return;
        }
        update(p.key, {
          state: 'ready',
          facts: facts.value,
          fingerprint: await fingerprint(p.file),
          declaredFps: suggestedFps(facts.value.fileFps),
        });
      })();
    }
  };

  const setRole = (key: string, role: ClipRole) =>
    setPicked((list) =>
      list.map((p) => {
        if (p.key === key) return { ...p, role, athleteId: role === 'run' ? p.athleteId : null };
        // One calibration clip per import: choosing another turns the previous one into a run.
        if (role === 'calibration' && p.role === 'calibration') return { ...p, role: 'run' };
        return p;
      }),
    );

  const latestCalibration: LocalCalibration | undefined = (calibrations.data ?? []).find(
    (c) => c.sessionId === sessionId,
  );

  const runImport = async () => {
    const ready = picked.filter((p) => p.state === 'ready');
    const next: string[] = [];
    if (ready.length === 0) next.push(strings.importClips.needsClip);
    if (ready.some((p) => p.role === 'run' && !p.athleteId))
      next.push(strings.importClips.needsAthlete);
    setProblems(next);
    if (next.length > 0) return;
    setBusy(true);
    writePreference(KEEP_COPIES_PREF, keepCopies ? null : 'false');
    const importedAt = new Date().toISOString();
    const records: LocalClip[] = [];
    const files = new Map<string, File>();
    let copyFailed = false;
    for (const p of ready) {
      if (!p.facts || !p.fingerprint) continue;
      const id = crypto.randomUUID();
      const copy = p.role === 'run' && keepCopies ? await keepCopy(id, p.file) : 'none';
      if (p.role === 'run' && keepCopies && copy === 'none') copyFailed = true;
      const probe = p.facts.probe;
      records.push({
        id,
        sessionId,
        athleteId: p.role === 'run' ? p.athleteId : null,
        role: p.role,
        calibrationId: p.role === 'run' ? (latestCalibration?.id ?? null) : null,
        fileName: p.file.name.slice(0, 260),
        size: p.file.size,
        fingerprint: p.fingerprint,
        widthPx: probe.widthPx,
        heightPx: probe.heightPx,
        frameCount: probe.frameCount,
        durationSec: probe.durationSec,
        codec: probe.codec.slice(0, 60),
        declaredFps: p.declaredFps,
        detectedFps: p.facts.fileFps,
        irregularShare: p.facts.irregularShare,
        copy,
        importedAt,
      });
      files.set(id, p.file);
    }
    await storeLocalClips(queryClient, records);
    setBusy(false);
    setPicked([]);
    const calibrationClip = records.find((r) => r.role === 'calibration');
    const file = calibrationClip ? files.get(calibrationClip.id) : undefined;
    if (calibrationClip && file) {
      setStage({ kind: 'calibrate', clip: calibrationClip, file, records });
    } else {
      setStage({ kind: 'done', clips: records, copyFailed });
    }
  };

  const finishCalibration = async (
    calibration: LocalCalibration | null,
    current: Extract<Stage, { kind: 'calibrate' }>,
  ) => {
    const imported = current.records;
    if (calibration) {
      await storeLocalCalibration(queryClient, calibration);
      const linked = imported.map((c) => ({ ...c, calibrationId: calibration.id }));
      await storeLocalClips(queryClient, linked);
      setStage({ kind: 'done', clips: linked, copyFailed: false });
    } else {
      setStage({ kind: 'done', clips: imported, copyFailed: false });
    }
  };

  if (session.isPending) return <LoadingState />;
  const s = session.data?.session;

  return (
    <>
      <section className={`${ui.card} ${styles.sessionCard}`} aria-labelledby="session-step">
        <div>
          <h2 id="session-step" className={styles.stepTitle}>
            {strings.importClips.sessionStep}
          </h2>
          <p className={styles.sessionLine}>
            {s
              ? `${formatDisplayDate(s.sessionDate)} · ${strings.sessions.details(strings.sessions.modes[s.mode], s.place)}`
              : strings.sessions.notFound}
          </p>
        </div>
        {stage.kind === 'clips' ? (
          <button type="button" className={`${ui.button} ${ui.quiet}`} onClick={onChangeSession}>
            {strings.importClips.change}
          </button>
        ) : null}
      </section>

      {stage.kind === 'clips' ? (
        <section className={sessionStyles.section} aria-labelledby="clips-step">
          <h2 id="clips-step">{strings.importClips.clipsStep}</h2>
          <ClipPicker
            label={strings.importClips.pick}
            hint={strings.importClips.pickHint}
            onPick={onPick}
          />
          <ul className={sessionStyles.list}>
            {picked.map((p) => (
              <li key={p.key}>
                <PickedCard
                  picked={p}
                  athletes={athletes.data ?? []}
                  sessionAthletes={sessionAthletes ?? []}
                  onRole={(role) => setRole(p.key, role)}
                  onAthlete={(athleteId) => update(p.key, { athleteId })}
                  onFps={(declaredFps) => update(p.key, { declaredFps })}
                  onRemove={() => setPicked((list) => list.filter((x) => x.key !== p.key))}
                />
              </li>
            ))}
          </ul>
          <label className={form.choice}>
            <input
              type="checkbox"
              checked={keepCopies}
              onChange={(e) => setKeepCopies(e.target.checked)}
            />
            <span>
              {strings.importClips.keepCopy}
              <span className={form.hint}> · {strings.importClips.keepCopyHint}</span>
            </span>
          </label>
          <StorageNotice />
          {problems.length > 0 ? (
            <div role="alert">
              {problems.map((p) => (
                <p key={p} className={form.error}>
                  {p}
                </p>
              ))}
            </div>
          ) : null}
          <div className={form.actions}>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={busy || picked.some((p) => p.state === 'reading')}
              onClick={() => void runImport()}
            >
              {busy ? strings.importClips.importing : strings.importClips.import}
            </button>
          </div>
        </section>
      ) : stage.kind === 'calibrate' ? (
        <section className={sessionStyles.section} aria-labelledby="calibrate-step">
          <h2 id="calibrate-step">{strings.importClips.calibrateStep}</h2>
          <CalibrationStep
            file={stage.file}
            clip={stage.clip}
            onDone={(cal) => void finishCalibration(cal, stage)}
          />
        </section>
      ) : (
        <DoneStep
          sessionId={sessionId}
          clips={stage.clips}
          copyFailed={stage.copyFailed}
          athletes={athletes.data ?? []}
        />
      )}
    </>
  );
}

function PickedCard({
  picked,
  athletes,
  sessionAthletes,
  onRole,
  onAthlete,
  onFps,
  onRemove,
}: {
  picked: Picked;
  athletes: Athlete[];
  sessionAthletes: string[];
  onRole: (role: ClipRole) => void;
  onAthlete: (athleteId: string | null) => void;
  onFps: (fps: number) => void;
  onRemove: () => void;
}) {
  const remove = (
    <button type="button" className={`${ui.button} ${ui.quiet}`} onClick={onRemove}>
      {strings.importClips.remove}
    </button>
  );
  if (picked.state === 'reading') {
    return (
      <div className={ui.card} aria-busy="true">
        <p className={styles.fileName}>{picked.file.name}</p>
        <p role="status">{strings.importClips.reading}</p>
      </div>
    );
  }
  if (picked.state === 'unreadable' || !picked.facts) {
    return (
      <div className={ui.card}>
        <p className={styles.fileName}>{picked.file.name}</p>
        <p className={form.error} role="alert">
          {strings.importClips.unreadable[picked.error ?? 'read_failed']}
        </p>
        {remove}
      </div>
    );
  }
  const probe = picked.facts.probe;
  const athlete = athletes.find((a) => a.id === picked.athleteId);
  const inSession = athletes.filter((a) => sessionAthletes.includes(a.id));
  const others = athletes.filter((a) => !sessionAthletes.includes(a.id));
  const option = (a: Athlete) => (
    <option key={a.id} value={a.id}>
      {a.firstName} {a.lastName}
    </option>
  );
  const groupName = `role-${picked.key}`;

  return (
    <ClipInfoCard
      facts={{
        fileName: picked.file.name,
        widthPx: probe.widthPx,
        heightPx: probe.heightPx,
        durationSec: probe.durationSec,
        codec: probe.codec,
        fileFps: picked.facts.fileFps,
        irregularShare: picked.facts.irregularShare,
      }}
    >
      <fieldset className={form.fieldset}>
        <legend className={form.legend}>{strings.importClips.role}</legend>
        <div className={styles.roles}>
          {(['run', 'calibration'] as const).map((role) => (
            <label key={role} className={form.choice}>
              <input
                type="radio"
                name={groupName}
                checked={picked.role === role}
                onChange={() => onRole(role)}
              />
              {strings.importClips.roles[role]}
            </label>
          ))}
        </div>
      </fieldset>
      {picked.role === 'run' ? (
        <div className={form.field}>
          <label className={form.label} htmlFor={`athlete-${picked.key}`}>
            {strings.importClips.athlete}
          </label>
          <select
            id={`athlete-${picked.key}`}
            className={form.input}
            value={picked.athleteId ?? ''}
            onChange={(e) => onAthlete(e.target.value || null)}
          >
            <option value="">{strings.importClips.chooseAthlete}</option>
            {inSession.length > 0 ? (
              <>
                <optgroup label={strings.importClips.sessionAthletes}>
                  {inSession.map(option)}
                </optgroup>
                <optgroup label={strings.importClips.otherAthletes}>{others.map(option)}</optgroup>
              </>
            ) : (
              athletes.map(option)
            )}
          </select>
          {athlete ? (
            <div className={styles.consent}>
              <ConsentBadge consents={athlete.consents} purpose="analysis" />
              {!canAnalyse(athlete) ? (
                <p className={form.hint}>
                  {strings.importClips.noConsent}{' '}
                  <Link to={`/athletes/${athlete.id}/consent`}>
                    {strings.athlete.recordConsent}
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={form.field}>
        <label className={form.label} htmlFor={`fps-${picked.key}`}>
          {strings.importClips.recordedAt}
        </label>
        <select
          id={`fps-${picked.key}`}
          className={form.input}
          value={picked.declaredFps}
          onChange={(e) => onFps(Number(e.target.value))}
        >
          {FPS_CHOICES.map((f) => (
            <option key={f} value={f}>
              {strings.importClips.fpsOption(f)}
            </option>
          ))}
        </select>
        <p className={form.hint}>{strings.importClips.recordedAtHint}</p>
      </div>
      {remove}
    </ClipInfoCard>
  );
}

function DoneStep({
  sessionId,
  clips,
  copyFailed,
  athletes,
}: {
  sessionId: string;
  clips: LocalClip[];
  copyFailed: boolean;
  athletes: Athlete[];
}) {
  const navigate = useNavigate();
  const runs = clips.filter((c) => c.role === 'run');
  const byId = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  return (
    <section className={sessionStyles.section} aria-labelledby="analyse-step">
      <h2 id="analyse-step">{strings.importClips.analyseStep}</h2>
      <p role="status">{strings.importClips.imported(clips.length)}</p>
      {copyFailed ? <p className={ui.notice}>{strings.importClips.copyFailed}</p> : null}
      {runs.length === 0 ? (
        <p>{strings.importClips.noRuns}</p>
      ) : (
        <>
          <p>{strings.importClips.nextBox}</p>
          <ul className={sessionStyles.list}>
            {runs.map((clip) => {
              const athlete = clip.athleteId ? byId.get(clip.athleteId) : undefined;
              return (
                <li key={clip.id}>
                  <button
                    type="button"
                    className={sessionStyles.row}
                    onClick={() => void navigate(`/analyse/${clip.id}`)}
                  >
                    <span className={sessionStyles.name}>
                      {athlete
                        ? `${athlete.firstName} ${athlete.lastName}`
                        : strings.sessions.unknownAthlete}
                    </span>
                    <span className={sessionStyles.meta}>
                      {clip.fileName} · {strings.clips.analyse}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Link to={`/sessions/${sessionId}`} className={`${ui.button} ${ui.quiet}`}>
        {strings.importClips.toSession}
      </Link>
    </section>
  );
}
