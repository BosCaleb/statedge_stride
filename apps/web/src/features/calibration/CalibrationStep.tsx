import { computeScale } from '@stride/analysis/calibration';
import { defaultConfig } from '@stride/analysis/config';
import { useEffect, useReducer, useState } from 'react';
import { FrameGrabber, frameJpeg } from '../../analysis-runtime/frameGrab';
import { grayscaleSignature } from '../../analysis-runtime/signature';
import form from '../../components/form.module.css';
import { ErrorState, LoadingState } from '../../components/States';
import ui from '../../components/ui.module.css';
import type { LocalCalibration, LocalClip } from '../../lib/local/records';
import { strings } from '../../lib/strings';
import { initialTaps, tapReducer, type TapAction, type TapState } from './calibrationTaps';
import { CalibrationOverlay } from './CalibrationOverlay';
import styles from './calibration.module.css';

// Calibration from the middle frame of the calibration clip: two marker taps and the real
// distance give the scale. Stores the taps, the scale, a grayscale signature of the frame for
// the camera-stability check and a JPEG of the frame. The clip itself is not kept.

type FrameState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; bitmap: ImageBitmap; timeSec: number };

const DEFAULT_DISTANCE_M = '5.00';

export function CalibrationStep({
  file,
  clip,
  onDone,
}: {
  file: Blob;
  clip: LocalClip;
  /** Called with the calibration, or null when the coach skips it. */
  onDone: (calibration: LocalCalibration | null) => void;
}) {
  const size = { width: clip.widthPx, height: clip.heightPx };
  const [frame, setFrame] = useState<FrameState>({ kind: 'loading' });
  const [taps, dispatch] = useReducer(
    (state: TapState, action: TapAction) => tapReducer(state, action, size),
    initialTaps,
  );
  const [distance, setDistance] = useState(DEFAULT_DISTANCE_M);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    const grabber = new FrameGrabber(file);
    void (async () => {
      try {
        const middle = (await grabber.duration()) / 2;
        const bitmap = await grabber.grab(middle, { width: clip.widthPx, height: clip.heightPx });
        if (live) setFrame({ kind: 'ready', bitmap, timeSec: middle });
        else bitmap.close();
      } catch {
        if (live) setFrame({ kind: 'failed' });
      } finally {
        grabber.dispose();
      }
    })();
    return () => {
      live = false;
    };
  }, [file, clip.widthPx, clip.heightPx]);

  useEffect(
    () => () => {
      if (frame.kind === 'ready') frame.bitmap.close();
    },
    [frame],
  );

  const distanceM = Number(distance.replace(',', '.'));
  const scale =
    taps.a && taps.b ? computeScale(taps.a, taps.b, distanceM, size.width, defaultConfig) : null;

  const confirm = async () => {
    if (frame.kind !== 'ready' || !scale?.ok || !taps.a || !taps.b) return;
    setSaving(true);
    const sigW = defaultConfig.calibration.signatureWidth;
    const sigH = defaultConfig.calibration.signatureHeight;
    const calibration: LocalCalibration = {
      id: crypto.randomUUID(),
      sessionId: clip.sessionId,
      clipId: clip.id,
      distanceM,
      markerA: taps.a,
      markerB: taps.b,
      pxPerM: scale.value.pxPerM,
      frameWidth: size.width,
      frameHeight: size.height,
      signature: grayscaleSignature(frame.bitmap, size.width, size.height, sigW, sigH),
      signatureWidth: sigW,
      signatureHeight: sigH,
      frame: await frameJpeg(frame.bitmap, size),
      frameTimeSec: frame.timeSec,
      createdAt: new Date().toISOString(),
    };
    onDone(calibration);
  };

  if (frame.kind === 'loading') return <LoadingState label={strings.calibration.loading} />;
  if (frame.kind === 'failed') {
    return (
      <ErrorState
        title={strings.calibration.frameFailed}
        action={
          <button type="button" className={`${ui.button} ${ui.quiet}`} onClick={() => onDone(null)}>
            {strings.calibration.skip}
          </button>
        }
      />
    );
  }

  const prompt = !taps.a
    ? strings.calibration.placeA
    : !taps.b
      ? strings.calibration.placeB
      : strings.calibration.adjust;

  return (
    <div className={styles.step}>
      <p className={styles.prompt} aria-live="polite">
        {prompt}
      </p>
      <CalibrationOverlay image={frame.bitmap} frame={size} taps={taps} onAction={dispatch} />
      <div className={form.field}>
        <label className={form.label} htmlFor="calibration-distance">
          {strings.calibration.distance}
        </label>
        <input
          id="calibration-distance"
          className={form.input}
          inputMode="decimal"
          value={distance}
          aria-invalid={distanceM > 0 ? undefined : true}
          onChange={(e) => setDistance(e.target.value)}
        />
        <p className={form.hint}>{strings.calibration.distanceHint}</p>
      </div>
      {scale ? (
        scale.ok ? (
          <div className={styles.result} role="status">
            <p className={styles.scale}>
              {strings.calibration.scale(scale.value.pxPerM.toFixed(1))}
            </p>
            {scale.value.warnings.map((w) => (
              <p key={w} className={ui.notice}>
                {strings.calibration.warnings[w]}
              </p>
            ))}
          </div>
        ) : (
          <p className={form.error} role="alert">
            {strings.calibration.errors[scale.reason]}
          </p>
        )
      ) : null}
      <div className={form.actions}>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={!scale?.ok || saving}
          onClick={() => void confirm()}
        >
          {strings.calibration.confirm}
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.quiet}`}
          disabled={saving}
          onClick={() => dispatch({ type: 'reset' })}
        >
          {strings.calibration.reset}
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.quiet}`}
          disabled={saving}
          onClick={() => onDone(null)}
        >
          {strings.calibration.skip}
        </button>
      </div>
      <p className={form.hint}>{strings.calibration.skipNote}</p>
    </div>
  );
}
