import { defaultConfig } from '@stride/analysis/config';
import { decodeSkp1, type DecodedKeypoints } from '@stride/analysis/skp1';
import type { Roi } from '@stride/analysis/types';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import type { Mode } from '@stride/shared/enums';
import type { QueryClient } from '@tanstack/react-query';
import { FrameGrabber } from '../../analysis-runtime/frameGrab';
import { startAnalysisJob, type JobOutcome } from '../../analysis-runtime/jobRunner';
import type { CalibrationInput, EstimatorSpec } from '../../analysis-runtime/messages';
import { storeLocalResult } from '../../lib/local/localQueries';
import type { LocalCalibration, LocalClip, LocalResult } from '../../lib/local/records';
import { putThumbnail, type KeyFrameKind } from '../../lib/local/thumbnails';
import { chosenPoseModel } from '../../lib/poseModelChoice';
import { readPreference } from '../../lib/storage';
import { strings } from '../../lib/strings';
import { thisPhoneFamily, trackEvent } from '../../lib/telemetry';
import { useJobStore } from '../../stores/jobStore';
import { renderKeyFrame } from '../results/keyFrameImage';

// Starting an analysis job and keeping what it produces. The job runs in a worker through
// jobRunner; this module feeds it the clip, calibration and box, follows its progress in the
// job store, and when the result passes (or passes with conditions) keeps it on the phone with
// its keypoints and three key frames, before any save. The work continues if the coach leaves
// the screen.

export interface AnalyseRequest {
  clip: LocalClip;
  file: Blob;
  calibration: LocalCalibration | null;
  roi: Roi;
  roiFrame: number;
  mode: Mode;
}

/** Test builds only: replay recorded keypoints instead of running the pose model. */
export const E2E_POSE_FIXTURE_PREF = 'stride.e2e.poseFixture';
/** Test builds only: run the real model on the CPU delegate (the nightly real-model check). */
export const E2E_POSE_DELEGATE_PREF = 'stride.e2e.poseDelegate';

function estimator(): EstimatorSpec {
  if (import.meta.env.VITE_E2E === 'true') {
    const fixture = readPreference(E2E_POSE_FIXTURE_PREF);
    if (fixture) return { kind: 'fixture', url: `/e2e-fixtures/${fixture}` };
    if (readPreference(E2E_POSE_DELEGATE_PREF) === 'CPU')
      return { kind: 'mediapipe', variant: 'full', delegate: 'CPU' };
  }
  return { kind: 'mediapipe', variant: chosenPoseModel(), delegate: 'GPU' };
}

export function calibrationInput(cal: LocalCalibration | null): CalibrationInput | null {
  if (!cal) return null;
  return {
    markerA: cal.markerA,
    markerB: cal.markerB,
    distanceM: cal.distanceM,
    pxPerM: cal.pxPerM,
    backgroundSignature: cal.signature,
    signatureWidth: cal.signatureWidth,
    signatureHeight: cal.signatureHeight,
    frameWidth: cal.frameWidth,
    frameHeight: cal.frameHeight,
  };
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Blob> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/** Key frames: the three moments of one well-detected stance, with the skeleton and a caption. */
export async function makeKeyFrames(
  analysisId: string,
  file: Blob,
  result: AnalysisResult,
  keypoints: DecodedKeypoints,
): Promise<void> {
  const kf = result.keyFrames;
  if (!kf) return;
  const grabber = new FrameGrabber(file);
  try {
    const frames: [KeyFrameKind, number][] = [
      ['ic', kf.icFrame],
      ['mid', kf.midFrame],
      ['to', kf.toFrame],
    ];
    for (const [kind, index] of frames) {
      const caption = strings.keyFrames.caption(kf.side, kind);
      const jpeg = await renderKeyFrame(grabber, keypoints, result.captureFps, index, caption);
      await putThumbnail(analysisId, kind, jpeg);
    }
  } finally {
    grabber.dispose();
  }
}

/** Keeps a finished result on the phone and returns it. */
export async function keepResult(
  queryClient: QueryClient,
  req: AnalyseRequest,
  outcome: Extract<JobOutcome, { kind: 'done' }>,
): Promise<LocalResult> {
  const athleteId = req.clip.athleteId;
  if (!athleteId) throw new Error('a run clip needs an athlete');
  const record: LocalResult = {
    id: crypto.randomUUID(),
    clipId: req.clip.id,
    sessionId: req.clip.sessionId,
    athleteId,
    calibrationId: req.calibration?.id ?? null,
    roi: req.roi,
    roiFrame: req.roiFrame,
    result: outcome.result,
    keypoints: await gzip(outcome.keypoints),
    stats: outcome.stats,
    noteDraft: '',
    createdAt: new Date().toISOString(),
    savedAt: null,
  };
  await storeLocalResult(queryClient, record);
  const decoded = decodeSkp1(outcome.keypoints);
  if (decoded.ok) {
    // Key frames are a convenience: a failure here keeps the result.
    await makeKeyFrames(record.id, req.file, outcome.result, decoded.value).catch(() => undefined);
  }
  return record;
}

/** The analysis_completed or analysis_failed event: counts and codes, nothing about the athlete. */
function reportOutcome(req: AnalyseRequest, outcome: JobOutcome): void {
  if (outcome.kind === 'failed') {
    if (outcome.code !== 'cancelled')
      trackEvent({ name: 'analysis_failed', code: outcome.code, phoneFamily: thisPhoneFamily() });
    return;
  }
  trackEvent({
    name: 'analysis_completed',
    mode: req.mode,
    gateStatus: outcome.result.gate.status,
    durationMs: Math.round(outcome.stats.wallMs),
    frameCount: outcome.result.clip.frameCount,
    fps: Math.round(outcome.result.captureFps),
    phoneFamily: thisPhoneFamily(),
  });
}

/** Starts the job and follows it to the end in the job store. */
export function startJob(queryClient: QueryClient, req: AnalyseRequest): void {
  const store = useJobStore.getState();
  const handle = startAnalysisJob(
    {
      file: req.file,
      calibration: calibrationInput(req.calibration),
      roi: req.roi,
      roiFrame: req.roiFrame,
      mode: req.mode,
      declaredFps: req.clip.declaredFps,
      config: defaultConfig,
      estimator: estimator(),
    },
    {
      onProgress: (stage, fraction) => useJobStore.getState().progress(stage, fraction),
      onPausedChange: (paused) => useJobStore.getState().setPaused(paused),
    },
  );
  store.begin(req.clip.id, handle);
  void handle.outcome.then(async (outcome) => {
    const { finish } = useJobStore.getState();
    reportOutcome(req, outcome);
    if (outcome.kind === 'failed') {
      finish(req.clip.id, { kind: 'failed', code: outcome.code, detail: outcome.detail });
    } else if (outcome.result.gate.status === 'fail') {
      finish(req.clip.id, { kind: 'gate_failed', result: outcome.result });
    } else {
      try {
        const kept = await keepResult(queryClient, req, outcome);
        finish(req.clip.id, { kind: 'kept', resultId: kept.id });
      } catch (error) {
        trackEvent({
          name: 'analysis_failed',
          code: 'out_of_memory',
          phoneFamily: thisPhoneFamily(),
        });
        finish(req.clip.id, {
          kind: 'failed',
          code: 'out_of_memory',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}
