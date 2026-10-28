import type { Roi } from '@stride/analysis/types';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import type { FailCode } from '@stride/shared/enums';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { probeClip } from '../../analysis-runtime/probe';
import shell from '../../app/shell.module.css';
import { ClipPicker } from '../../components/ClipPicker';
import form from '../../components/form.module.css';
import { FrameScrubber } from '../../components/FrameScrubber';
import { JobProgress } from '../../components/JobProgress';
import { RoiSelector } from '../../components/RoiSelector';
import { ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { useLocalCalibrations, useLocalClips } from '../../lib/local/localQueries';
import type { LocalClip } from '../../lib/local/records';
import { strings } from '../../lib/strings';
import { useFrameAt } from '../../lib/useFrameAt';
import { useJobStore } from '../../stores/jobStore';
import { canAnalyse, useAthlete } from '../athletes/athleteData';
import { useClipFile } from '../results/useClipFile';
import { useSession } from '../sessions/sessionData';
import { GateChecksList } from './GateChecksList';
import { startJob } from './runAnalysis';
import styles from './analyse.module.css';

/** /analyse/:clipId: choose the calibration, draw the athlete box, run, watch progress. */
export function AnalysePage() {
  const { clipId = '' } = useParams();
  const clips = useLocalClips();
  const job = useJobStore((s) => s.job);
  const outcome = useJobStore((s) => s.outcome);
  const clearOutcome = useJobStore((s) => s.clearOutcome);
  const navigate = useNavigate();
  const clip = clips.data?.find((c) => c.id === clipId);
  const finished = outcome?.clipId === clipId ? outcome.finished : null;

  useEffect(() => {
    if (finished?.kind !== 'kept') return;
    clearOutcome();
    void navigate(`/analyses/${finished.resultId}`, { replace: true });
  }, [finished, clearOutcome, navigate]);

  if (job) {
    return (
      <JobProgress
        stage={job.stage}
        fraction={job.fraction}
        startedAt={job.startedAt}
        paused={job.paused}
        wasPaused={job.wasPaused}
        onCancel={() => job.handle.cancel()}
      />
    );
  }
  if (clips.isPending) return <LoadingState />;
  if (!clip || clip.role !== 'run') return <ErrorState title={strings.analyse.clipNotFound} />;
  if (finished?.kind === 'gate_failed')
    return <GateFailureView clip={clip} result={finished.result} onRetry={clearOutcome} />;
  if (finished?.kind === 'failed' && finished.code !== 'cancelled')
    return <JobFailureView clip={clip} code={finished.code} onRetry={clearOutcome} />;
  if (finished?.kind === 'kept') return <LoadingState />;
  return <AnalyseSetup clip={clip} />;
}

/** Frame times from the container, for the frame scrubber. */
function useClipTimes(file: Blob | null): Float64Array | null {
  const [times, setTimes] = useState<Float64Array | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    void probeClip(file).then((p) => {
      if (live) setTimes(p.ok ? p.value.containerTimesSec : null);
    });
    return () => {
      live = false;
    };
  }, [file]);
  return times;
}

function AnalyseSetup({ clip }: { clip: LocalClip }) {
  const queryClient = useQueryClient();
  const session = useSession(clip.sessionId);
  const athlete = useAthlete(clip.athleteId ?? '');
  const calibrations = useLocalCalibrations();
  const { state: fileState, pick } = useClipFile(clip);
  const file = fileState.kind === 'ready' ? fileState.file : null;
  const times = useClipTimes(file);
  const [frameIndex, setFrameIndex] = useState(0);
  const [roi, setRoi] = useState<Roi | null>(null);
  const [wrongFile, setWrongFile] = useState(false);
  const sessionCals = (calibrations.data ?? []).filter((c) => c.sessionId === clip.sessionId);
  const [calibrationId, setCalibrationId] = useState<string | null | undefined>(undefined);
  const chosenId =
    calibrationId === undefined
      ? sessionCals.some((c) => c.id === clip.calibrationId)
        ? clip.calibrationId
        : (sessionCals[0]?.id ?? null)
      : calibrationId;
  const calibration = sessionCals.find((c) => c.id === chosenId) ?? null;
  const size = { width: clip.widthPx, height: clip.heightPx };
  const first = times?.[0] ?? 0;
  const quarter = 0.25 / Math.max(1, clip.detectedFps ?? clip.declaredFps);
  const frameTime = times ? (times[frameIndex] ?? first) - first : null;
  const image = useFrameAt(file, frameTime === null ? null : frameTime + quarter, size);
  const mode = session.data?.session.mode;
  const consented = canAnalyse(athlete.data);
  const jobRunning = useJobStore((s) => s.running);

  const name = athlete.data
    ? `${athlete.data.firstName} ${athlete.data.lastName}`
    : strings.sessions.unknownAthlete;

  return (
    <div className={shell.page}>
      <h1>{strings.analyse.title}</h1>
      <p className={styles.lead}>
        {strings.analyse.athlete(name)} · {clip.fileName}
      </p>

      {athlete.data && !consented ? (
        <div className={ui.notice} role="alert">
          <p>{strings.analyse.noConsent}</p>
          <Link to={`/athletes/${athlete.data.id}/consent`}>{strings.athlete.recordConsent}</Link>
        </div>
      ) : null}

      {fileState.kind === 'missing' ? (
        <section className={styles.section} aria-labelledby="file-heading">
          <h2 id="file-heading">{strings.analyse.needsFileTitle}</h2>
          <p>{strings.analyse.needsFile}</p>
          <ClipPicker
            label={strings.analyse.pickOriginal}
            multiple={false}
            onPick={(files) => {
              const [f] = files;
              if (f) void pick(f).then((ok) => setWrongFile(!ok));
            }}
          />
          {wrongFile ? (
            <p className={form.error} role="alert">
              {strings.analyse.wrongFile}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="calibration-heading">
        <h2 id="calibration-heading">{strings.analyse.calibration}</h2>
        <div className={form.field}>
          <label className={form.label} htmlFor="analyse-calibration">
            {strings.analyse.calibrationLabel}
          </label>
          <select
            id="analyse-calibration"
            className={form.input}
            value={chosenId ?? ''}
            onChange={(e) => setCalibrationId(e.target.value || null)}
          >
            {sessionCals.map((c) => (
              <option key={c.id} value={c.id}>
                {strings.sessions.calibrationShort(c.distanceM.toFixed(2), c.pxPerM.toFixed(0))}
              </option>
            ))}
            <option value="">{strings.analyse.noCalibration}</option>
          </select>
          {!calibration ? <p className={form.hint}>{strings.calibration.skipNote}</p> : null}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="box-heading">
        <h2 id="box-heading">{strings.analyse.boxStep}</h2>
        <p className={form.hint}>{strings.analyse.boxHint}</p>
        {fileState.kind === 'loading' || (file && !times) ? (
          <LoadingState />
        ) : file && times ? (
          <>
            <RoiSelector image={image} frame={size} roi={roi} onChange={setRoi} />
            <FrameScrubber
              index={frameIndex}
              count={times.length}
              timeSec={frameTime ?? 0}
              onChange={(i) => {
                setFrameIndex(i);
                setRoi(null);
              }}
            />
          </>
        ) : null}
      </section>

      <div className={form.actions}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!file || !roi || !mode || !consented || jobRunning}
          onClick={() => {
            if (!file || !roi || !mode) return;
            startJob(queryClient, {
              clip,
              file,
              calibration,
              roi,
              roiFrame: frameIndex,
              mode,
            });
          }}
        >
          {strings.analyse.start}
        </button>
        <Link to={`/sessions/${clip.sessionId}`} className={`${ui.button} ${ui.quiet}`}>
          {strings.analyse.toSession}
        </Link>
      </div>
    </div>
  );
}

function GateFailureView({
  clip,
  result,
  onRetry,
}: {
  clip: LocalClip;
  result: AnalysisResult;
  onRetry: () => void;
}) {
  return (
    <div className={shell.page}>
      <h1>{strings.analyse.gateFailedTitle}</h1>
      <p>{strings.analyse.gateFailedBody}</p>
      <GateChecksList checks={result.gate.checks.filter((c) => c.level === 'fail')} />
      {result.gate.checks.some((c) => c.level === 'warn') ? (
        <>
          <h2>{strings.analyse.alsoNoticed}</h2>
          <GateChecksList checks={result.gate.checks.filter((c) => c.level === 'warn')} />
        </>
      ) : null}
      <div className={form.actions}>
        <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onRetry}>
          {strings.analyse.tryAgain}
        </button>
        <Link to={`/sessions/${clip.sessionId}`} className={`${ui.button} ${ui.quiet}`}>
          {strings.analyse.toSession}
        </Link>
      </div>
    </div>
  );
}

function JobFailureView({
  clip,
  code,
  onRetry,
}: {
  clip: LocalClip;
  code: FailCode;
  onRetry: () => void;
}) {
  return (
    <ErrorState
      title={strings.analyse.failedTitle}
      body={strings.jobFailures[code]}
      action={
        <div className={form.actions}>
          <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onRetry}>
            {strings.analyse.tryAgain}
          </button>
          <Link to={`/sessions/${clip.sessionId}`} className={`${ui.button} ${ui.quiet}`}>
            {strings.analyse.toSession}
          </Link>
        </div>
      }
    />
  );
}
