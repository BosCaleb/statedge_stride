import { decodeSkp1, encodeSkp1, type DecodedKeypoints } from '@stride/analysis/skp1';
import { runSynthetic } from '@stride/analysis/testing/runSynthetic';
import { DISTANCE_GAIT, generateGait } from '@stride/analysis/testing/syntheticGait';
import type { Roi } from '@stride/analysis/types';
import type { Athlete } from '@stride/shared/api/athletes';
import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { OutboxPill } from '../../app/OutboxPill';
import shell from '../../app/shell.module.css';
import { ClipInfoCard } from '../../components/ClipInfoCard';
import { ClipPicker } from '../../components/ClipPicker';
import { ConfidenceBadge } from '../../components/ConfidenceBadge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ConsentBadge } from '../../components/ConsentBadge';
import { ConsentForm } from '../../components/ConsentForm';
import { EventTimeline } from '../../components/EventTimeline';
import { FrameCanvas } from '../../components/FrameCanvas';
import { FrameScrubber } from '../../components/FrameScrubber';
import { GateBanner } from '../../components/GateBanner';
import { JobProgress } from '../../components/JobProgress';
import { MetricCard } from '../../components/MetricCard';
import { RoiSelector } from '../../components/RoiSelector';
import { SkeletonOverlay } from '../../components/SkeletonOverlay';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import { CalibrationOverlay } from '../calibration/CalibrationOverlay';
import {
  initialTaps,
  tapReducer,
  type TapAction,
  type TapState,
} from '../calibration/calibrationTaps';
import { drawSkeleton } from '../results/skeleton';
import styles from './gallery.module.css';

// /dev/gallery: every screen component with sample data, for review and for testing by hand.
// Developer-only: compiled out unless VITE_ENABLE_DEV_PAGES=true. Not translated.

const FRAME = { width: 1920, height: 1080 };

/** The synthetic runner of the end-to-end clip (scripts/generate-test-clips.ts), as keypoints. */
function syntheticKeypoints(): DecodedKeypoints {
  const clip = generateGait({ ...DISTANCE_GAIT, noisePx: 0, seed: 101 });
  const bytes = encodeSkp1({
    widthPx: FRAME.width,
    heightPx: FRAME.height,
    mirrored: false,
    timesSec: clip.timesSec,
    frames: clip.frames.map((f) => f.landmarks),
  });
  const decoded = decodeSkp1(bytes);
  if (!decoded.ok) throw new Error(decoded.reason);
  return decoded.value;
}

/** A track with two cones 5 m apart and the runner at frame 0, drawn on a canvas. */
async function sceneBitmap(keypoints: DecodedKeypoints): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(FRAME.width, FRAME.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = '#c4dcec';
  ctx.fillRect(0, 0, FRAME.width, 778);
  ctx.fillStyle = '#b05840';
  ctx.fillRect(0, 778, FRAME.width, FRAME.height - 778);
  ctx.fillStyle = '#f47820';
  for (const x of [585, 1335]) {
    ctx.beginPath();
    ctx.moveTo(x - 14, 918);
    ctx.lineTo(x + 14, 918);
    ctx.lineTo(x, 878);
    ctx.fill();
  }
  const first = keypoints.frames[0];
  if (first)
    drawSkeleton(ctx, first, 1, {
      left: '#0d1c3e',
      right: '#0d1c3e',
      centre: '#0d1c3e',
      lineWidth: 10,
      minVisibility: 0,
    });
  return createImageBitmap(canvas);
}

const athlete: Athlete = {
  id: '6a1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22',
  firstName: 'Lerato',
  lastName: 'Molefe',
  birthYear: 2012,
  externalRef: null,
  createdAt: '2026-03-01T10:00:00.000Z',
  consents: { analysis: null, sharing: null, clip_storage: null },
};

function Story({ name, children }: { name: string; children: ReactNode }) {
  const id = `story-${name}`;
  return (
    <section id={id} className={styles.story} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.storyTitle}>
        {name}
      </h2>
      {children}
    </section>
  );
}

export function GalleryPage() {
  const keypoints = useMemo(syntheticKeypoints, []);
  const conditional = useMemo(
    () =>
      runSynthetic(generateGait({ noisePx: 2, dropoutRate: 0.02 }), {
        mode: 'distance',
        calibration: null,
      }).result,
    [],
  );
  const [scene, setScene] = useState<ImageBitmap | null>(null);
  const [taps, dispatch] = useReducer(
    (s: TapState, a: TapAction) => tapReducer(s, a, FRAME),
    initialTaps,
  );
  const [roi, setRoi] = useState<Roi | null>({ x: 90, y: 540, width: 290, height: 410 });
  const [frame, setFrame] = useState(120);
  const [dialog, setDialog] = useState(false);
  const [clip, setClip] = useState<File | null>(null);

  useEffect(() => {
    let live = true;
    void sceneBitmap(keypoints).then((b) => {
      if (live) setScene(b);
    });
    return () => {
      live = false;
    };
  }, [keypoints]);

  const stories = [
    'AppShell',
    'OutboxPill',
    'States',
    'ConfirmDialog',
    'ConsentBadge',
    'ConsentForm',
    'ClipPicker',
    'ClipInfoCard',
    'CalibrationOverlay',
    'RoiSelector',
    'FrameScrubber',
    'FrameCanvas',
    'SkeletonOverlay',
    'EventTimeline',
    'MetricCard',
    'ConfidenceBadge',
    'GateBanner',
    'JobProgress',
  ];

  return (
    <div className={shell.page}>
      <h1>Component gallery</h1>
      <nav aria-label="Components">
        <ul className={styles.index}>
          {stories.map((s) => (
            <li key={s}>
              <a href={`#story-${s}`}>{s}</a>
            </li>
          ))}
        </ul>
      </nav>

      <Story name="AppShell">
        <p>This page is drawn inside the app shell: header, outbox pill, account menu, nav.</p>
      </Story>
      <Story name="OutboxPill">
        <OutboxPill />
      </Story>
      <Story name="States">
        <LoadingState />
        <EmptyState title="No athletes yet" body="Add the athletes you coach." />
        <ErrorState title="Something went wrong" onRetry={() => undefined} />
      </Story>
      <Story name="ConfirmDialog">
        <button
          type="button"
          className={`${ui.button} ${ui.quiet}`}
          onClick={() => setDialog(true)}
        >
          Open the dialog
        </button>
        <ConfirmDialog
          open={dialog}
          title="Remove the copy of this clip?"
          danger
          onCancel={() => setDialog(false)}
          onConfirm={() => setDialog(false)}
        >
          <p>Results stay.</p>
        </ConfirmDialog>
      </Story>
      <Story name="ConsentBadge">
        <ConsentBadge consents={athlete.consents} purpose="analysis" />
      </Story>
      <Story name="ConsentForm">
        <ConsentForm athlete={athlete} today="2026-03-14" onSubmit={() => undefined} />
      </Story>
      <Story name="ClipPicker">
        <ClipPicker
          label="Choose a clip"
          hint="Picks a video. The FrameCanvas story plays it."
          multiple={false}
          onPick={(files) => setClip(files[0] ?? null)}
        />
      </Story>
      <Story name="ClipInfoCard">
        <ClipInfoCard
          label="Run · Lerato Molefe"
          facts={{
            fileName: 'VID_20260314_101500.mp4',
            widthPx: 1920,
            heightPx: 1080,
            durationSec: 4.96,
            codec: 'avc1.640028',
            fileFps: 239.76,
            irregularShare: 0,
          }}
        />
        <ClipInfoCard
          facts={{
            fileName: 'retimed.mp4',
            widthPx: 1920,
            heightPx: 1080,
            durationSec: 39.7,
            codec: 'hvc1.1.6.L120.B0',
            fileFps: 30,
            irregularShare: 0.012,
          }}
        />
      </Story>
      <Story name="CalibrationOverlay">
        <CalibrationOverlay image={scene} frame={FRAME} taps={taps} onAction={dispatch} />
      </Story>
      <Story name="RoiSelector">
        <RoiSelector image={scene} frame={FRAME} roi={roi} onChange={setRoi} />
      </Story>
      <Story name="FrameScrubber">
        <FrameScrubber
          index={frame}
          count={keypoints.frames.length}
          timeSec={frame / 240}
          onChange={setFrame}
        />
      </Story>
      <Story name="FrameCanvas">
        {clip ? (
          <FrameCanvas file={clip} keypoints={keypoints} initialFrame={0} onFrame={setFrame} />
        ) : (
          <p>Pick fixtures/clips/synthetic-run-240fps.mp4 with the ClipPicker above.</p>
        )}
      </Story>
      <Story name="SkeletonOverlay">
        <div className={styles.still}>
          <SkeletonOverlay keypoints={keypoints} frame={frame} />
        </div>
      </Story>
      <Story name="EventTimeline">
        <EventTimeline
          events={conditional.events}
          frameCount={keypoints.frames.length}
          currentFrame={frame}
          onJump={setFrame}
        />
      </Story>
      <Story name="MetricCard">
        <ul className={styles.cards}>
          {conditional.metrics.slice(0, 6).map((m) => (
            <li key={m.id}>
              <MetricCard metric={m} />
            </li>
          ))}
        </ul>
      </Story>
      <Story name="ConfidenceBadge">
        <p className={styles.row}>
          <ConfidenceBadge confidence="high" />
          <ConfidenceBadge confidence="medium" />
          <ConfidenceBadge confidence="low" />
          <ConfidenceBadge confidence="unavailable" />
        </p>
      </Story>
      <Story name="GateBanner">
        <GateBanner result={conditional} />
      </Story>
      <Story name="JobProgress">
        <div className={styles.contained}>
          <JobProgress
            stage="finding"
            fraction={0.42}
            startedAt={Date.now() - 95_000}
            paused={false}
            wasPaused
            onCancel={() => undefined}
          />
        </div>
      </Story>
    </div>
  );
}
