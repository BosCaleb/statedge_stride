import type { AnalysisConfig } from '@stride/shared/analysisConfig';
import type { Roi } from './types';

// Choosing the runner among the people an object detector found in sampled frames, for the
// athlete box suggestion. Pure: the detector runs in the web app, this decides. The runner is a
// person fully in view who does not stand still across the samples (people at the side of the
// track keep their place, the runner crosses it), at the earliest frame where they are nearly as
// large as they get, because the analysis starts at that frame.

export interface PersonBox extends Roi {
  /** Detection score, 0 to 1. */
  score: number;
}

export interface FrameDetections {
  /** Index of the decoded frame the boxes were found in. */
  frame: number;
  boxes: PersonBox[];
}

export interface RunnerChoice {
  frame: number;
  /** The suggested athlete box: the detection, padded and kept inside the frame. */
  roi: Roi;
  score: number;
}

type RunnerConfig = AnalysisConfig['runnerDetection'];

/** Evenly spaced frames to look at, skipping the first and last 5 percent of the clip. */
export function sampleFrames(frameCount: number, samples: number): number[] {
  if (frameCount <= 0) return [];
  const first = Math.floor(frameCount * 0.05);
  const last = Math.max(first, Math.ceil(frameCount * 0.95) - 1);
  const n = Math.min(samples, last - first + 1);
  if (n <= 1) return [first];
  return Array.from({ length: n }, (_, i) => Math.round(first + ((last - first) * i) / (n - 1)));
}

function iou(a: Roi, b: Roi): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlap = x * y;
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

function pad(box: Roi, share: number, frame: { width: number; height: number }): Roi {
  const x = Math.max(0, box.x - box.width * share);
  const y = Math.max(0, box.y - box.height * share);
  const right = Math.min(frame.width, box.x + box.width * (1 + share));
  const bottom = Math.min(frame.height, box.y + box.height * (1 + share));
  return { x, y, width: right - x, height: bottom - y };
}

/** The runner and the frame to start from, or null when no suitable person was found. */
export function chooseRunner(
  samples: readonly FrameDetections[],
  frame: { width: number; height: number },
  config: RunnerConfig,
): RunnerChoice | null {
  const marginX = frame.width * config.edgeMarginShare;
  const marginY = frame.height * config.edgeMarginShare;
  const candidates = samples.flatMap((s) =>
    s.boxes
      .filter((b) => b.score >= config.minScore && b.height >= frame.height * config.minHeightShare)
      .map((box) => {
        const others = samples.filter((o) => o !== s);
        const overlapping = others.filter((o) =>
          o.boxes.some((b) => iou(b, box) >= config.staticIou),
        ).length;
        return {
          frame: s.frame,
          box,
          inView:
            box.x >= marginX &&
            box.y >= marginY &&
            box.x + box.width <= frame.width - marginX &&
            box.y + box.height <= frame.height - marginY,
          still: others.length >= 2 && overlapping >= config.staticShare * others.length,
        };
      }),
  );
  // The best class of candidate: moving if anyone moves, fully in view if anyone is.
  const moving = candidates.some((c) => !c.still) ? candidates.filter((c) => !c.still) : candidates;
  const pool = moving.some((c) => c.inView) ? moving.filter((c) => c.inView) : moving;
  // The analysis starts at the box's frame: of the frames where the runner is nearly as large as
  // at their largest, the earliest keeps the most of the run.
  const largest = Math.max(0, ...pool.map((c) => c.box.height));
  const best = pool
    .filter((c) => c.box.height >= config.nearLargestShare * largest)
    .sort((a, b) => a.frame - b.frame || b.box.score - a.box.score)[0];
  if (!best) return null;
  return {
    frame: best.frame,
    roi: pad(best.box, config.padShare, frame),
    score: best.box.score,
  };
}
