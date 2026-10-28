import type { DecodedKeypoints } from '@stride/analysis/skp1';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameCanvas, type FrameCanvasHandle } from './FrameCanvas';

// The player as the comparison drives it: no controls of its own, only the handle.

const FRAMES = 100;
const keypoints: DecodedKeypoints = {
  header: {
    version: 1,
    frameCount: FRAMES,
    landmarkCount: 33,
    widthPx: 1920,
    heightPx: 1080,
    mirrored: false,
    expectedBytes: 0,
  },
  timesSec: Float64Array.from({ length: FRAMES }, (_, i) => i / 240),
  frames: Array.from({ length: FRAMES }, () => null),
};

beforeEach(() => {
  // jsdom has no media playback and no object URLs.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  Object.assign(URL, { createObjectURL: () => 'blob:clip', revokeObjectURL: () => undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPlayer() {
  const handle = createRef<FrameCanvasHandle>();
  render(
    <FrameCanvas
      ref={handle}
      file={new Blob(['clip'])}
      keypoints={keypoints}
      initialFrame={32}
      onFrame={() => undefined}
      controls={false}
      label="Earlier"
    />,
  );
  return handle;
}

describe('FrameCanvas', () => {
  it('shows its frame without controls of its own', () => {
    renderPlayer();
    expect(screen.getByText(/^Frame 33 of 100/)).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('steps from the first frame it will show, even before the video has loaded', () => {
    const handle = renderPlayer();
    const video = document.querySelector('video');
    if (!video) throw new Error('no video element');
    // As it loads, the video reports its first frame; that does not move the player.
    act(() => {
      fireEvent.seeked(video);
    });
    expect(handle.current?.frame()).toBe(32);
    act(() => handle.current?.seek((handle.current.frame() ?? 0) + 1));
    expect(screen.getByText(/^Frame 34 of 100/)).toBeInTheDocument();

    // Loading the video keeps the frame stepped to, instead of going back to the first one.
    act(() => {
      fireEvent.loadedData(video);
    });
    expect(screen.getByText(/^Frame 34 of 100/)).toBeInTheDocument();
    expect(handle.current?.frame()).toBe(33);
  });
});
