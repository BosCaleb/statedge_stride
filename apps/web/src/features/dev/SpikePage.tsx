import { defaultAnalysisConfig } from '@stride/analysis/config';
import { analyse, type AnalysisDiagnostics } from '@stride/analysis/pipeline';
import { decodeSkp1, type DecodedKeypoints } from '@stride/analysis/skp1';
import { chooseTimebase, timingStats, type TimingStats } from '@stride/analysis/timebase';
import type { Roi } from '@stride/analysis/types';
import { CLIP_CHECK_IDS, type Mode } from '@stride/shared/enums';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  nearestIndex,
  webCodecsSource,
  webCodecsSupported,
  type FrameSource,
} from '../../analysis-runtime/decoder';
import { videoElementSource } from '../../analysis-runtime/fallbackDecoder';
import {
  startAnalysisJob,
  type JobHandle,
  type JobOutcome,
} from '../../analysis-runtime/jobRunner';
import type { Delegate, ModelVariant } from '../../analysis-runtime/poseEstimator';
import { probeClip, type ClipProbe } from '../../analysis-runtime/probe';
import { drawSkeleton } from '../results/skeleton';
import { LinePlot, type PlotBand, type PlotMarker } from './LinePlot';
import styles from './spike.module.css';

// M0 spike page: measure real clips on the phone. Developer-only (excluded from production).
// Clip inspector (codec, resolution, frame count, frame timing), decode benchmarks for both
// decoders, pose timing per frame on either delegate, event traces, and keypoint export.

interface DecodeBench {
  kind: FrameSource['kind'];
  frames: number;
  ms: number;
  dropped: number;
  error?: string;
}

interface RunRecord {
  file: string;
  delegate: string;
  decoder: string;
  poseMs: number;
  wallSec: number;
  gate: string;
  cadence: string;
  contact: string;
  events: number;
}

const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits);

export function SpikePage() {
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<ClipProbe | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [webCodecsOk, setWebCodecsOk] = useState<boolean | null>(null);
  const [declaredFps, setDeclaredFps] = useState(240);
  const [mode, setMode] = useState<Mode>('sprint');
  const [delegate, setDelegate] = useState<Delegate>('GPU');
  const [variant, setVariant] = useState<ModelVariant>('full');
  /** Test builds only: replay recorded keypoints instead of running the model. */
  const [fixtureUrl, setFixtureUrl] = useState('');
  const [benches, setBenches] = useState<DecodeBench[]>([]);
  const [roi, setRoi] = useState<Roi | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [outcome, setOutcome] = useState<JobOutcome | null>(null);
  const [keypoints, setKeypoints] = useState<DecodedKeypoints | null>(null);
  const [diagnostics, setDiagnostics] = useState<AnalysisDiagnostics | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const job = useRef<JobHandle | null>(null);
  const config = useMemo(() => defaultAnalysisConfig(), []);

  const timing: TimingStats | null = useMemo(
    () =>
      probe ? timingStats(probe.containerTimesSec, config.gate.timing.intervalTolerance) : null,
    [probe, config],
  );
  const timebase = useMemo(
    () => (probe ? chooseTimebase(probe.containerTimesSec, declaredFps, config) : null),
    [probe, declaredFps, config],
  );

  const pick = async (f: File | null) => {
    setFile(f);
    setProbe(null);
    setProbeError(null);
    setBenches([]);
    setRoi(null);
    setOutcome(null);
    setKeypoints(null);
    setDiagnostics(null);
    if (!f) return;
    const probed = await probeClip(f);
    if (!probed.ok) {
      setProbeError(probed.reason);
      return;
    }
    setProbe(probed.value);
    setWebCodecsOk(await webCodecsSupported(probed.value));
  };

  const bench = async (kind: FrameSource['kind']) => {
    if (!file || !probe) return;
    const source =
      kind === 'webcodecs'
        ? webCodecsSource(file, probe, { startFrame: 0, frameStep: 1 })
        : videoElementSource(file, probe, { startFrame: 0, frameStep: 1 });
    const started = performance.now();
    let frames = 0;
    try {
      for await (const frame of source.frames(new AbortController().signal)) {
        frame.bitmap.close();
        frames++;
      }
      setBenches((b) => [
        ...b,
        { kind, frames, ms: performance.now() - started, dropped: source.droppedFrames },
      ]);
    } catch (e) {
      setBenches((b) => [
        ...b,
        { kind, frames, ms: performance.now() - started, dropped: 0, error: String(e) },
      ]);
    }
  };

  const run = async () => {
    if (!file || !probe) return;
    setOutcome(null);
    setDiagnostics(null);
    const box = roi ?? { x: 0, y: 0, width: probe.widthPx, height: probe.heightPx };
    const handle = startAnalysisJob(
      {
        file,
        calibration: null,
        roi: box,
        roiFrame: 0,
        mode,
        declaredFps,
        config,
        estimator: fixtureUrl
          ? { kind: 'fixture', url: fixtureUrl }
          : { kind: 'mediapipe', variant, delegate },
      },
      {
        onProgress: (stage, fraction) => setProgress(`${stage} ${(fraction * 100).toFixed(0)}%`),
        onPausedChange: (paused) => setProgress(paused ? 'paused (page hidden)' : 'resumed'),
      },
    );
    job.current = handle;
    const result = await handle.outcome;
    job.current = null;
    setOutcome(result);
    setProgress(result.kind === 'done' ? 'done' : `failed: ${result.code} ${result.detail}`);
    if (result.kind !== 'done') return;
    const decoded = decodeSkp1(result.keypoints);
    if (!decoded.ok) return;
    setKeypoints(decoded.value);
    const tb = chooseTimebase(decoded.value.timesSec, declaredFps, config);
    const output = analyse({
      frames: decoded.value.frames.map((l, index) => ({ index, tSec: 0, landmarks: l })),
      clip: result.result.clip,
      timesSec: tb.ok ? tb.value.timesSec : decoded.value.timesSec,
      timebase: result.result.timebase,
      captureFps: result.result.captureFps,
      frameStep: result.result.frameStep,
      mode,
      calibration: null,
      clipChecks: result.result.gate.checks.filter((c) =>
        (CLIP_CHECK_IDS as readonly string[]).includes(c.id),
      ),
      poseModel: result.result.poseModel,
      config,
      createdAt: result.result.createdAt,
    });
    setDiagnostics(output.diagnostics);
    const metric = (id: string) => result.result.metrics.find((m) => m.id === id)?.value;
    setRuns((r) => [
      ...r,
      {
        file: file.name,
        delegate: result.stats.delegate,
        decoder: result.stats.decoder,
        poseMs: result.stats.poseMsMedian,
        wallSec: result.stats.wallMs / 1000,
        gate: result.result.gate.status,
        cadence: fmt(metric('cadence'), 0),
        contact: fmt(metric('contact_time'), 0),
        events: result.result.events.length,
      },
    ]);
  };

  const download = () => {
    if (!outcome || outcome.kind !== 'done' || !file) return;
    const url = URL.createObjectURL(
      new Blob([outcome.keypoints], { type: 'application/octet-stream' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.name.replace(/\.[^.]+$/, '')}.skp1`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className={styles.page}>
      <h1>Spike: clip inspector, decode and pose</h1>
      <p className={styles.note}>
        Developer page (M0). Pick an original slow-motion file from the phone. Results stay on this
        device.
      </p>
      <label className={styles.field}>
        Clip
        <input
          type="file"
          accept="video/*"
          onChange={(e) => void pick(e.target.files?.[0] ?? null)}
        />
      </label>
      {probeError && <p role="alert">Could not read the clip: {probeError}</p>}
      {probe && timing && (
        <section aria-label="Clip">
          <h2>Clip</h2>
          <table className={styles.table}>
            <tbody>
              <tr>
                <th>Codec</th>
                <td>{probe.codec}</td>
              </tr>
              <tr>
                <th>WebCodecs can decode</th>
                <td>{webCodecsOk === null ? '…' : webCodecsOk ? 'yes' : 'no (fallback)'}</td>
              </tr>
              <tr>
                <th>Display size</th>
                <td>
                  {probe.widthPx} × {probe.heightPx} (coded {probe.codedWidth} × {probe.codedHeight}
                  , rotation {probe.rotation}°)
                </td>
              </tr>
              <tr>
                <th>Frames</th>
                <td>{probe.frameCount}</td>
              </tr>
              <tr>
                <th>Duration</th>
                <td>{fmt(probe.durationSec, 3)} s</td>
              </tr>
              <tr>
                <th>Container rate</th>
                <td>
                  {fmt(timing.impliedFps, 2)} fps (median interval{' '}
                  {fmt(timing.medianIntervalSec * 1000, 3)} ms)
                </td>
              </tr>
              <tr>
                <th>Irregular intervals</th>
                <td>
                  {fmt(timing.irregularShare * 100, 2)}%, dropped {timing.droppedFrames}
                </td>
              </tr>
              <tr>
                <th>Time base</th>
                <td>
                  {timebase?.ok
                    ? `${timebase.value.source} at ${fmt(timebase.value.fps, 1)} fps`
                    : 'not plausible'}
                </td>
              </tr>
              <tr>
                <th>File size</th>
                <td>{fmt(probe.fileSize / 1e6, 1)} MB</td>
              </tr>
            </tbody>
          </table>
          <LinePlot
            title="Frame interval (ms) by frame"
            series={[
              {
                label: 'interval',
                colour: '#F47820',
                x: Array.from(timing.intervalsSec, (_v, i) => i),
                y: Array.from(timing.intervalsSec, (v) => v * 1000),
              },
            ]}
          />
          <h2>Decode</h2>
          <div className={styles.row}>
            <button type="button" onClick={() => void bench('webcodecs')} disabled={!webCodecsOk}>
              Benchmark WebCodecs
            </button>
            <button type="button" onClick={() => void bench('video-element')}>
              Benchmark video element
            </button>
          </div>
          {benches.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Decoder</th>
                  <th>Frames</th>
                  <th>Time</th>
                  <th>Decode fps</th>
                  <th>Dropped</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {benches.map((b, i) => (
                  <tr key={i}>
                    <td>{b.kind}</td>
                    <td>{b.frames}</td>
                    <td>{fmt(b.ms / 1000, 2)} s</td>
                    <td>{fmt(b.frames / (b.ms / 1000), 0)}</td>
                    <td>{b.dropped}</td>
                    <td>{b.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2>Pose</h2>
          <FirstFrameBox file={file} probe={probe} roi={roi} onChange={setRoi} />
          <div className={styles.row}>
            <label>
              Declared fps{' '}
              <input
                type="number"
                value={declaredFps}
                min={24}
                max={1000}
                onChange={(e) => setDeclaredFps(Number(e.target.value))}
              />
            </label>
            <label>
              Mode{' '}
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option value="sprint">sprint</option>
                <option value="distance">distance</option>
              </select>
            </label>
            <label>
              Delegate{' '}
              <select value={delegate} onChange={(e) => setDelegate(e.target.value as Delegate)}>
                <option>GPU</option>
                <option>CPU</option>
              </select>
            </label>
            <label>
              Model{' '}
              <select value={variant} onChange={(e) => setVariant(e.target.value as ModelVariant)}>
                <option value="full">full</option>
                <option value="heavy">heavy</option>
              </select>
            </label>
            {import.meta.env.VITE_E2E === 'true' && (
              <label>
                Fixture keypoints URL{' '}
                <input value={fixtureUrl} onChange={(e) => setFixtureUrl(e.target.value)} />
              </label>
            )}
          </div>
          <div className={styles.row}>
            <button type="button" onClick={() => void run()} disabled={job.current !== null}>
              Run analysis
            </button>
            <button type="button" onClick={() => job.current?.cancel()}>
              Cancel
            </button>
            <span aria-live="polite">{progress}</span>
          </div>
          {outcome?.kind === 'done' && (
            <>
              <table className={styles.table}>
                <tbody>
                  <tr>
                    <th>Decoder / delegate</th>
                    <td>
                      {outcome.stats.decoder} / {outcome.stats.delegate}
                    </td>
                  </tr>
                  <tr>
                    <th>Pose ms per frame (median)</th>
                    <td>{fmt(outcome.stats.poseMsMedian, 1)}</td>
                  </tr>
                  <tr>
                    <th>Total time</th>
                    <td>
                      {fmt(outcome.stats.wallMs / 1000, 1)} s for {outcome.stats.framesAnalysed}{' '}
                      frames ({outcome.stats.framesWithPose} with a pose)
                    </td>
                  </tr>
                  <tr>
                    <th>Stopped early at</th>
                    <td>{outcome.stats.stoppedAt ?? '–'}</td>
                  </tr>
                  <tr>
                    <th>Gate</th>
                    <td>
                      {outcome.result.gate.status}:{' '}
                      {outcome.result.gate.checks
                        .filter((c) => c.level !== 'pass')
                        .map((c) => `${c.id} ${c.level} (${c.detail})`)
                        .join(', ') || 'all checks pass'}
                    </td>
                  </tr>
                </tbody>
              </table>
              <button type="button" onClick={download}>
                Download keypoints (SKP1)
              </button>
              <h3>Metrics</h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Value</th>
                    <th>Left</th>
                    <th>Right</th>
                    <th>n</th>
                    <th>Confidence</th>
                    <th>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {outcome.result.metrics.map((m) => (
                    <tr key={m.id}>
                      <td>{m.id}</td>
                      <td>
                        {fmt(m.value, 2)} {m.unit}
                      </td>
                      <td>{fmt(m.bySide?.left, 2)}</td>
                      <td>{fmt(m.bySide?.right, 2)}</td>
                      <td>{m.n}</td>
                      <td>{m.confidence}</td>
                      <td>{m.reasons.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {diagnostics && outcome?.kind === 'done' && (
            <EventTraces diagnostics={diagnostics} outcome={outcome} />
          )}
          {keypoints && file && <OverlayPlayer file={file} keypoints={keypoints} />}
          {runs.length > 0 && (
            <>
              <h2>Runs this session (compare repeated passes)</h2>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Decoder</th>
                    <th>Delegate</th>
                    <th>ms/frame</th>
                    <th>Total s</th>
                    <th>Gate</th>
                    <th>Events</th>
                    <th>Cadence</th>
                    <th>Contact ms</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={i}>
                      <td>{r.file}</td>
                      <td>{r.decoder}</td>
                      <td>{r.delegate}</td>
                      <td>{fmt(r.poseMs, 1)}</td>
                      <td>{fmt(r.wallSec, 1)}</td>
                      <td>{r.gate}</td>
                      <td>{r.events}</td>
                      <td>{r.cadence}</td>
                      <td>{r.contact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </main>
  );
}

/** Shows the first frame and lets the developer drag the athlete box. */
function FirstFrameBox({
  file,
  probe,
  roi,
  onChange,
}: {
  file: File | null;
  probe: ClipProbe;
  roi: Roi | null;
  onChange: (roi: Roi) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<ImageBitmap | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const scale = Math.min(1, 640 / probe.widthPx);

  useEffect(() => {
    if (!file) return;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;
    const onSeeked = () => {
      void createImageBitmap(video).then((bitmap) => {
        image.current = bitmap;
        paint(null);
      });
    };
    video.addEventListener('loadeddata', () => (video.currentTime = 0.001), { once: true });
    video.addEventListener('seeked', onSeeked, { once: true });
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint only reads refs
  }, [file]);

  const paint = (box: Roi | null) => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    c.width = probe.widthPx * scale;
    c.height = probe.heightPx * scale;
    if (image.current) ctx.drawImage(image.current, 0, 0, c.width, c.height);
    const b = box ?? roi;
    if (b) {
      ctx.strokeStyle = '#F47820';
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x * scale, b.y * scale, b.width * scale, b.height * scale);
    }
  };

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * probe.widthPx,
      y: ((e.clientY - rect.top) / rect.height) * probe.heightPx,
    };
  };
  const box = (a: { x: number; y: number }, b: { x: number; y: number }): Roi => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(8, Math.abs(b.x - a.x)),
    height: Math.max(8, Math.abs(b.y - a.y)),
  });

  return (
    <div>
      <p className={styles.note}>
        Drag a box around the athlete on the first frame (default: the whole frame).
      </p>
      <canvas
        ref={canvas}
        className={styles.frame}
        aria-label="First frame. Drag to draw the athlete box."
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = point(e);
        }}
        onPointerMove={(e) => drag.current && paint(box(drag.current, point(e)))}
        onPointerUp={(e) => {
          if (drag.current) onChange(box(drag.current, point(e)));
          drag.current = null;
        }}
      />
    </div>
  );
}

function EventTraces({
  diagnostics,
  outcome,
}: {
  diagnostics: AnalysisDiagnostics;
  outcome: Extract<JobOutcome, { kind: 'done' }>;
}) {
  const detection = diagnostics.detection;
  const track = diagnostics.track;
  if (!detection || !track) return <p>No events: the leg length could not be measured.</p>;
  const config = outcome.result.configSnapshot;
  const step = outcome.result.frameStep;
  const times = Array.from(track.times);
  return (
    <section aria-label="Event traces">
      <h3>Contacts and toe-offs over the foot traces</h3>
      {(['left', 'right'] as const).map((side) => {
        const events = outcome.result.events.filter((e) => e.side === side);
        const bands: PlotBand[] = events.map((e) => ({
          from: e.icTimeSec,
          to: e.toTimeSec ?? e.icTimeSec,
          colour: side === 'left' ? '#F4782033' : '#1E4F8C33',
        }));
        const markers: PlotMarker[] = events.flatMap((e) => [
          { x: e.icTimeSec, colour: '#2a9d4b', label: `IC ${e.agreement === 'both' ? '✓' : '?'}` },
          ...(e.toTimeSec !== null ? [{ x: e.toTimeSec, colour: '#c0392b', label: 'TO' }] : []),
        ]);
        const t = detection.traces[side];
        return (
          <div key={side}>
            <LinePlot
              title={`${side} contact-point speed (leg lengths per second)`}
              series={[{ label: 'speed', colour: '#1E4F8C', x: times, y: Array.from(t.speedLeg) }]}
              bands={bands}
              markers={markers}
              thresholds={[
                { y: config.events.stanceSpeedLegPerSec, colour: '#c0392b', label: 'stance speed' },
              ]}
              yRange={[0, 10]}
            />
            <LinePlot
              title={`${side} contact-point height above ground (leg lengths)`}
              series={[
                { label: 'height', colour: '#F47820', x: times, y: Array.from(t.heightLeg) },
              ]}
              bands={bands}
              markers={markers}
              thresholds={[
                { y: config.events.groundBandLeg, colour: '#c0392b', label: 'ground band' },
              ]}
              yRange={[-0.1, 0.6]}
            />
          </div>
        );
      })}
      <p className={styles.note}>
        Frame step {step}. Shaded: detected stance. ✓ both methods agree, ? primary only.
      </p>
    </section>
  );
}

function OverlayPlayer({ file, keypoints }: { file: File; keypoints: DecodedKeypoints }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c) return;
    let handle = 0;
    const draw = (_now: number, meta: VideoFrameCallbackMetadata) => {
      const ctx = c.getContext('2d');
      if (ctx) {
        c.width = v.clientWidth;
        c.height = v.clientHeight;
        ctx.clearRect(0, 0, c.width, c.height);
        const index = nearestIndex(
          keypoints.timesSec,
          meta.mediaTime + (keypoints.timesSec[0] ?? 0),
        );
        const landmarks = keypoints.frames[index];
        if (landmarks) {
          drawSkeleton(ctx, landmarks, c.width / keypoints.header.widthPx, {
            left: '#F47820',
            right: '#1E4F8C',
            centre: '#ffffff',
            lineWidth: 3,
            minVisibility: 0.3,
          });
        }
      }
      handle = v.requestVideoFrameCallback(draw);
    };
    handle = v.requestVideoFrameCallback(draw);
    return () => v.cancelVideoFrameCallback(handle);
  }, [keypoints]);

  return (
    <section aria-label="Skeleton overlay">
      <h3>Skeleton over the clip</h3>
      <div className={styles.overlay}>
        <video
          ref={video}
          src={url}
          controls
          muted
          playsInline
          onLoadedData={(e) => (e.currentTarget.playbackRate = 0.125)}
        />
        <canvas ref={canvas} aria-hidden="true" />
      </div>
    </section>
  );
}
