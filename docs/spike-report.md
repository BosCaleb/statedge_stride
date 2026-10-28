# M0 spike report

**Status: on-device measurements not yet taken.** The spike tooling is built and has been
exercised in headless Chromium on a 4-core Linux build machine with synthetic clips. The M0 gate
needs real Samsung Galaxy S23 Ultra and iPhone clips, measured on those phones. Fill in the
tables in section 3, update `packages/analysis/src/config.ts` from the results (bump
`ALGORITHM_VERSION`), and record the decisions in section 5.

## 1. How to run the spike on a phone

The spike page is `/dev/spike`. It is included in development servers and in builds with
`VITE_ENABLE_DEV_PAGES=true` (the dev environment), and never in production builds.

WebCodecs and OPFS need a secure context, so the phone must load the page over HTTPS or as
`localhost`:

- **Android (S23 Ultra):** enable USB debugging, connect the phone, run `adb reverse tcp:5173
tcp:5173`, start `pnpm --filter @stride/web dev`, and open `http://localhost:5173/dev/spike` in
  Chrome on the phone. Use `chrome://inspect` on the computer for the console.
- **iPhone:** use the dev environment deployment (HTTPS), or Safari Web Inspector with a tunnel.
- Run `pnpm fetch-models` first (add `--heavy` to try the heavy model).

Record with the native camera app in **Slow motion** (not Super slow-mo), 1080p, 240 fps, on a
tripod, side-on, as in the capture guide. Import the **original** file (not a shared or edited
copy). For each clip the page shows container facts, a frame-interval plot, decode benchmarks for
both decoders, pose timing per frame, the event traces and the metrics, and can download the raw
keypoints for `fixtures/`.

## 2. Measured so far (headless Chromium, build machine, synthetic clips)

| Measurement                                                                              | Result                                                         | Notes                                                                                           |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Container probe of a 1080p 240 fps VP9 file                                              | 594 frames, 240.00 fps, 0% irregular                           | `fixtures/clips/synthetic-run-240fps.mp4`                                                       |
| Probe with the moov box after the media data                                             | Works (mp4box seeks to the moov)                               | Many phones write moov last                                                                     |
| Probe of H.264, HEVC, VP9, rotated and re-timed 30 fps files                             | All read correctly, with decoder configuration                 | `fixtures/clips/probe/`                                                                         |
| WebCodecs decode, VP9 1080p, software decoder                                            | 594 of 594 frames, 46 fps                                      | A VM without hardware decode; phones decode in hardware                                         |
| Video-element fallback, playbackRate 0.2                                                 | 421 of 594 frames, 152 gaps                                    | **Drops frames when rendering cannot keep up.** Measure on the phones; lower the rate if needed |
| MediaPipe in a **module** worker with the ES-module WASM (`vision_wasm_module_internal`) | Loads and runs (XNNPACK CPU delegate)                          | The classic (IIFE) worker fallback is not needed in Chromium                                    |
| Full worker pipeline (WebCodecs, ROI tracking, analysis, SKP1) with recorded keypoints   | 594 frames in 12.7 s, all tracked, result as in the pure tests | Most of the time is software VP9 decoding                                                       |

Pose time per frame on a phone, and the GPU delegate, can only be measured on the devices.

## 3. M0 gate measurements (to fill in)

| Gate check                                                    | Method                                                         | S23 Ultra | iPhone | Decision |
| ------------------------------------------------------------- | -------------------------------------------------------------- | --------- | ------ | -------- |
| Real frame timing of slow-motion files                        | Clip inspector: container rate, irregular share, interval plot |           |        |          |
| Does WebCodecs decode them, or is the fallback needed?        | "WebCodecs can decode", decode benchmarks                      |           |        |          |
| Milliseconds per frame for pose (GPU and CPU delegate)        | Run analysis with each delegate                                |           |        |          |
| Total time for a 5 s 240 fps clip (target under 90 s)         | Run analysis: total time                                       |           |        |          |
| Are events stable across repeated passes by the same athlete? | Runs table: events, cadence, contact time per pass             |           |        |          |
| Are foot landmarks good enough at the achieved athlete size?  | Event traces; `feet_visible` and `athlete_size` checks         |           |        |          |

Also record: model variant used, the athlete's height in pixels, memory behaviour over a long
clip (Chrome task manager), whether the screen wake lock held, and whether a hidden tab paused and
resumed cleanly.

## 4. Synthetic accuracy baseline

The synthetic gait generator (`packages/analysis/src/testing/syntheticGait.ts`) gives a ground
truth to compare against. With the starting thresholds from the specification, on 240 fps data:

| Quantity                                             | Distance (4 m/s, 176 spm, 220 ms contact)  | Sprint (7.5 m/s, 270 spm, 110 ms contact) |
| ---------------------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| Cadence                                              | within 0.5 spm                             | within 1 spm                              |
| Initial contact time                                 | detected about 8 ms late                   | about 8 ms late                           |
| Toe-off time                                         | detected about 9 ms early                  | about 10 ms early                         |
| Contact time                                         | **about 14 ms short**                      | **about 16 ms short**                     |
| Overstride                                           | about 2.5 % of leg length low              | about 5 % low                             |
| Knee flexion at contact                              | about 4 degrees high                       | about 2 degrees high                      |
| Trunk lean, step length, speed, vertical oscillation | within 0.1 degree, 0.01 m, 0.01 m/s, 0.1 % | same                                      |

The timing bias comes from smoothing: the zero-phase low-pass spreads the abrupt stop and start
of the foot, so the smoothed foot speed crosses the stance threshold after contact and before
toe-off. Measured sensitivity (contact time, distance / sprint):

| `stanceSpeedLegPerSec` | 1.5 (spec)  | 2.5          | 3.5          |
| ---------------------- | ----------- | ------------ | ------------ |
| Contact time           | 206 / 94 ms | 219 / 100 ms | 229 / 106 ms |

| Low-pass cut-off (distance / sprint) | 12 / 20 Hz  | 16 / 25 Hz (chosen) | 20 / 30 Hz   | 25 / 40 Hz           |
| ------------------------------------ | ----------- | ------------------- | ------------ | -------------------- |
| Contact time, clean                  | 202 / 92 ms | 206 / 94 ms         | 209 / 97 ms  | 211 / 100 ms         |
| Contact time, 3 px noise             | 201 / 97 ms | 203 / 96 ms         | 189 / 119 ms | 113 / 141 ms (fails) |

So the stance speed threshold is the main lever, and higher cut-offs break down with noise. Real
feet and real landmark noise will differ from the synthetic ones; the spike should compare
detected contact and toe-off frames with a manual frame count on two or three clips before
choosing values. The spec's `contact_time` ceiling (medium unless 200 fps and good agreement)
already limits how confidently these numbers are shown.

## 5. Decisions (provisional until measured on the phones)

| Area        | Provisional decision                                                                             | Confirm by                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Decoder     | WebCodecs with mp4box.js in the worker; video element with requestVideoFrameCallback as fallback | Decode benchmarks on both phones, especially HEVC on the S23 and Safari                                  |
| Worker type | Module worker loading MediaPipe's ES-module WASM build                                           | Pose run on Safari (classic IIFE worker is the fallback: `worker.format: 'iife'` and `useModule: false`) |
| Delegate    | GPU, falling back to CPU automatically when WebGL is unavailable                                 | Pose ms per frame on each delegate                                                                       |
| Model       | `pose_landmarker_full` (float16, version 1); heavy selectable                                    | Landmark quality at the achieved athlete size                                                            |
| Frame step  | Every frame; every second frame in distance mode is the first speed lever                        | Total time for a 5 s clip                                                                                |

## 6. Configuration

No values have been changed from device data yet. Values the specification did not give are
marked `NOT IN SPEC` in `config.ts` and listed in `docs/decisions.md`.

## 7. Open questions

1. Do Samsung slow-motion files store real 240 fps timestamps, or a re-timed 30 fps timeline? The
   time base handles both, but the declared rate then comes from the coach or the device profile.
2. Does the video-element fallback keep every frame on the phones at playbackRate 0.25?
3. Is the IC/TO timing bias on real clips close to the synthetic one? If so, raise
   `stanceSpeedLegPerSec` (about 2.5 removed the distance-running bias on synthetic data).
4. Does Safari's WebCodecs decode HEVC slow-motion files from an iPhone?
