import type { DecodedKeypoints } from '@stride/analysis/skp1';
import { frameJpeg, type FrameGrabber } from '../../analysis-runtime/frameGrab';
import { drawSkeleton } from './skeleton';

// Key-frame images, for the result viewer and reports: a frame of the clip with the skeleton
// drawn over it and a caption band, as JPEG.

const SKELETON_STYLE = {
  left: '#F47820',
  right: '#1E4F8C',
  centre: '#ffffff',
  lineWidth: 6,
  minVisibility: 0.3,
};

/**
 * One frame of the clip as a key-frame JPEG: at most 1280 px wide, with the skeleton and a
 * caption band, under 300 KB. `index` counts frames of the keypoint file.
 */
export async function renderKeyFrame(
  grabber: FrameGrabber,
  keypoints: DecodedKeypoints,
  captureFps: number,
  index: number,
  caption: string,
): Promise<Blob> {
  const times = keypoints.timesSec;
  const first = times[0] ?? 0;
  const size = { width: keypoints.header.widthPx, height: keypoints.header.heightPx };
  const quarter = 0.25 / Math.max(1, captureFps);
  const bitmap = await grabber.grab((times[index] ?? first) - first + quarter, size);
  try {
    return await frameJpeg(bitmap, size, (ctx, scale) => {
      const landmarks = keypoints.frames[index];
      if (landmarks) drawSkeleton(ctx, landmarks, scale, SKELETON_STYLE);
      const w = size.width * scale;
      const h = size.height * scale;
      ctx.fillStyle = 'rgb(13 28 62 / 80%)';
      ctx.fillRect(0, h - 56, w, 56);
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 28px Inter, system-ui, sans-serif';
      ctx.fillText(caption, 20, h - 18);
    });
  } finally {
    bitmap.close();
  }
}
