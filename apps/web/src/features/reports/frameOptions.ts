import type { DecodedKeypoints } from '@stride/analysis/skp1';
import { useEffect, useState } from 'react';
import { FrameGrabber } from '../../analysis-runtime/frameGrab';
import { getThumbnail, KEY_FRAME_KINDS } from '../../lib/local/thumbnails';
import { strings } from '../../lib/strings';
import type { AnalysisSource } from '../results/analysisSource';
import { renderKeyFrame } from '../results/keyFrameImage';
import type { ClipFileState } from '../results/useClipFile';

// The frames a report can show for one analysis: its three automatic key frames, kept on the
// phone when the analysis was made here, or drawn from the clip when the coach picks it; and any
// other frame of the clip, drawn when the coach adds it.

export interface FrameOption {
  /** Unique in the report, and the snapshot's frame label: a1:ic, a2:f412. */
  label: string;
  caption: string;
  jpeg: Blob;
}

export type AutoFrames =
  | { status: 'loading' }
  /** Not on the phone, and the clip is needed to draw them. */
  | { status: 'needsClip' }
  | { status: 'none' }
  | { status: 'ready'; frames: FrameOption[] };

/** a1 for a single analysis or the earlier of two, a2 for the later. */
export type FramePrefix = 'a1' | 'a2';

export function captionFor(base: string, comparisonSide: 'earlier' | 'later' | null): string {
  if (!comparisonSide) return base;
  const which =
    comparisonSide === 'earlier' ? strings.reports.frameEarlier : strings.reports.frameLater;
  return `${which}: ${base}`;
}

export function useAutoFrames(
  source: AnalysisSource | null,
  prefix: FramePrefix,
  comparisonSide: 'earlier' | 'later' | null,
  file: ClipFileState,
  keypoints: DecodedKeypoints | null,
): AutoFrames {
  const [state, setState] = useState<AutoFrames>({ status: 'loading' });
  const id = source?.id;
  const keyFrames = source?.result.keyFrames;
  const fps = source?.result.captureFps ?? 0;
  const ready = file.kind === 'ready' ? file.file : null;

  useEffect(() => {
    if (!id) return;
    if (!keyFrames) {
      setState({ status: 'none' });
      return;
    }
    let live = true;
    void (async () => {
      const at = { ic: keyFrames.icFrame, mid: keyFrames.midFrame, to: keyFrames.toFrame };
      const frames: FrameOption[] = [];
      let grabber: FrameGrabber | null = null;
      try {
        for (const kind of KEY_FRAME_KINDS) {
          const base = strings.keyFrames.caption(keyFrames.side, kind);
          let jpeg = await getThumbnail(id, kind);
          if (!jpeg && ready && keypoints) {
            grabber ??= new FrameGrabber(ready);
            jpeg = await renderKeyFrame(grabber, keypoints, fps, at[kind], base);
          }
          if (!jpeg) {
            if (live)
              setState({ status: ready || file.kind !== 'missing' ? 'loading' : 'needsClip' });
            return;
          }
          frames.push({
            label: `${prefix}:${kind}`,
            caption: captionFor(base, comparisonSide),
            jpeg,
          });
        }
        if (live) setState({ status: 'ready', frames });
      } finally {
        grabber?.dispose();
      }
    })();
    return () => {
      live = false;
    };
  }, [id, keyFrames, fps, ready, keypoints, prefix, comparisonSide, file.kind]);

  return state;
}

/** Draws any frame of the clip for the report, with the skeleton and a caption. */
export async function renderChosenFrame(
  file: Blob,
  keypoints: DecodedKeypoints,
  source: AnalysisSource,
  frame: number,
  prefix: FramePrefix,
  comparisonSide: 'earlier' | 'later' | null,
): Promise<FrameOption> {
  const base = strings.reports.frameCaption(frame);
  const grabber = new FrameGrabber(file);
  try {
    const jpeg = await renderKeyFrame(grabber, keypoints, source.result.captureFps, frame, base);
    return { label: `${prefix}:f${frame}`, caption: captionFor(base, comparisonSide), jpeg };
  } finally {
    grabber.dispose();
  }
}
