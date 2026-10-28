# StatEdge Stride: Web App Technical Specification (MVP)


## Purpose and how to use this spec

This document specifies the Stride web app MVP in enough detail for Claude Code to build it in small, testable steps. Stride is a StatEdge Sport product: a coach films an athlete in slow motion on a phone, imports the clip, and gets running-technique metrics and annotated frames computed on the phone. The product background, pricing, capture protocol and bill of materials are in the earlier product spec. This document covers the software only.

### Goals

- A coach can sign in, add an athlete with consent, import a slow-motion clip, calibrate it, analyse it on the device, review the result, add notes and export a PDF, using only a phone browser.
- Pose analysis runs on the phone. Video is not uploaded by default.
- Everything runs on Azure, with personal data stored in South Africa North, for a monthly infrastructure cost well under US$20.
- The analysis code is pure, typed and unit-testable without a browser or a model.

### Non-goals for the MVP

- Athlete or parent portal, billing and payments, native apps, server-side video processing.
- Front or rear views, 3D reconstruction, injury prediction, any medical claim.
- Automatic marker detection (the coach taps the markers).
- Cloud video storage. The data model reserves fields for it, but it is a stretch milestone.

### Principles for the build

1. **Pure logic stays pure.** Filters, event detection, metrics and the quality gate live in a package with no DOM, network or model dependencies, tested on recorded keypoint fixtures.
2. **The model is replaceable.** All pose estimation sits behind one interface, so MediaPipe can be swapped without touching metrics.
3. **Never show a number you cannot defend.** Every metric carries a confidence label, and a failed quality gate hides results instead of guessing.
4. **Consent is enforced in code.** No analysis can be saved to the cloud for an athlete without a valid consent record.
5. **Local first.** The core loop must work with poor connectivity at a track. Saving to the cloud can wait.
6. **Boring and cheap.** Prefer free tiers, managed identity over secrets, and a small number of services.

### Assumptions that the spike must confirm

The numbers marked as starting values in this spec (thresholds, filter cutoffs, distances) are expected to change after the week 1 to 2 spike. Keep them in one configuration module with comments, never scattered through the code. The test device is a Samsung Galaxy S23 Ultra recording 1080p slow motion at 240 fps in the native camera app. Safari on iOS is the second target.

### How Claude Code should work from this spec

- Build in the order in the last section, one milestone at a time, and stop at each gate for review.
- Treat each section as a requirement. Where a value is a starting value, implement it as configuration and note it.
- Do not add services, libraries or features that are not named here without asking.
- Write the tests listed in the testing section alongside each feature, not afterwards.
- When something here is ambiguous or conflicts with reality, raise it as a question with a proposed default. Do not guess silently.

## Architecture

Stride is a single-page, installable web app. The heavy work (decoding, pose estimation, metrics) runs in a worker on the phone, and a small Azure API stores results. There are no servers to patch and no GPU costs.

&#91;embedded content: System architecture: phone, static hosting, sign-in, South Africa North data tier\]

The browser calls the API directly with a bearer token. The API reaches the database with a managed identity, so no database secrets exist anywhere.

### Decisions

| Area | Choice | Alternatives considered | Reason |
| --- | --- | --- | --- |
| Front end | React 18, TypeScript, Vite, React Router, installable PWA | Next.js, native apps | Matches Tournament Manager. Static hosting on the free plan. No server rendering needed |
| Pose model | MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`), self-hosted WASM and model files | MoveNet, RTMPose through ONNX Runtime Web | Apache 2.0 licence, 33 landmarks including heel and foot index, GPU delegate in the browser. Hidden behind a `PoseEstimator` interface so it can be swapped |
| Video decode | WebCodecs with `mp4box.js` for demuxing, `<video>` plus `requestVideoFrameCallback` as fallback | `ffmpeg.wasm` | Exact frame timestamps with low overhead. The fallback covers codecs WebCodecs cannot decode on a given phone |
| API | Azure Functions, Node.js 20 or later, TypeScript, v4 programming model, Consumption plan, South Africa North | App Service, Container Apps | Free monthly grant and no idle cost. Keeps API processing in South Africa |
| Database | Azure SQL Database free offer, T-SQL, row-level security | PostgreSQL Flexible Server, Cosmos DB | US$0. Relational data fits the model. See the infrastructure section for the Postgres upgrade path |
| Database access | `mssql` (tedious driver) with Entra authentication through managed identity | Connection strings and SQL logins | No secrets in code or in GitHub |
| Sign-in | Microsoft Entra External ID with `@azure/msal-browser` and `@azure/msal-react` | Custom auth, Supabase Auth | Azure-native, free for the first 50,000 monthly active users. Roles live in our database, not in the token |
| Validation | `zod` schemas in a shared package, used by both the web app and the API | Hand-written checks | One definition of every request and result |
| State | TanStack Query for server state, Zustand for UI and job state, `idb` for IndexedDB | Redux | Small and typed |
| Styling | CSS with design tokens (CSS modules), no Tailwind | Tailwind, CSS-in-JS | Same approach as Tournament Manager |
| PDF | `jspdf` and `jspdf-autotable`, client-side, dynamically imported | Server-side rendering | Already in the StatEdge stack and no server cost |
| Infrastructure | Terraform in the `statedge-infra` repository, with its own `stride` environment and state file | Bicep, portal clicks | Matches the Azure migration plan |

## Repository, tooling and conventions

Use one pnpm monorepo called `statedge-stride`. The pure analysis code and the shared schemas are separate packages so that they can be tested and reused without the app.

```
statedge-stride/
  apps/
    web/                     React + Vite PWA
      src/
        app/                 routes, providers, layout, auth guard
        features/            athletes, sessions, import, analysis, results,
                             compare, reports, settings, device-check, guide
        analysis-runtime/    DOM-bound code: decoder, pose runner, worker glue
        lib/                 api client, msal, idb, opfs, pdf, config
        styles/              tokens.css, base.css
      public/models/         pose model and WASM files (self-hosted)
    api/                     Azure Functions (Node.js, TypeScript)
      src/functions/         one file per route group
      src/lib/               auth, db, rls, errors, audit, validation
      migrations/            numbered .sql files
  packages/
    shared/                  zod schemas, types, constants (API and result schema)
    analysis/                pure TypeScript: filters, events, metrics, gate, calibration
  fixtures/                  recorded keypoint files and tiny test clips
  scripts/                   create-org, seed, fixture tools
  .github/workflows/         ci.yml, deploy-web.yml, deploy-api.yml
  CLAUDE.md
```

### Tooling

| Concern | Choice |
| --- | --- |
| Package manager | pnpm workspaces, Node 20 LTS or later, `.nvmrc` committed |
| Language | TypeScript in strict mode with `noUncheckedIndexedAccess` |
| Lint and format | ESLint with `typescript-eslint`, Prettier, Stylelint for CSS |
| Unit tests | Vitest. React Testing Library for components |
| End-to-end | Playwright (Chromium, plus a mobile viewport project) |
| Build | Vite for the web app. `tsc` and Azure Functions Core Tools for the API |
| Commits | Trunk-based with short branches and pull requests. Conventional commit prefixes |

### Coding conventions

- Parse every boundary with zod: API requests and responses, IndexedDB reads, worker messages, and the stored result JSON.
- Pure functions return values. Expected failures (a bad clip, a missing landmark) are returned as typed results such as `{ ok: false, reason }`. Throw only for programmer errors.
- All thresholds, cutoffs, distances and weights live in `packages/analysis/src/config.ts`, one exported object with a comment per value.
- IDs are UUID v4 generated on the client with `crypto.randomUUID()`, which makes writes idempotent.
- Times are stored in UTC and sent as ISO 8601. Dates shown to users use `dd/MM/yyyy`, as in Tournament Manager.
- No `any`. No default exports except where a framework requires them. No barrel files that hide dependency direction.
- Dependency direction: `apps/*` may import from `packages/*`. `packages/analysis` may import only from `packages/shared`. Nothing in `packages/*` may import from `apps/*`.
- Licences: only MIT, Apache 2.0, BSD or ISC dependencies. No AGPL or GPL code. A CI step lists licences and fails on anything else.

### Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | web | Base URL of the Functions API |
| `VITE_ENTRA_TENANT_SUBDOMAIN` | web | External tenant sign-in host |
| `VITE_ENTRA_CLIENT_ID` | web | SPA app registration ID |
| `VITE_API_SCOPE` | web | Scope of the API, for example `access_as_user` |
| `SQL_SERVER`, `SQL_DATABASE` | api | Azure SQL host and database name |
| `ENTRA_TENANT_ID`, `ENTRA_API_AUDIENCE` | api | Token validation settings |
| `ALLOWED_ORIGINS` | api | Comma-separated CORS origins |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | api, web | Telemetry |

None of these is a secret. There are no secrets in the repository or in GitHub: the API uses a managed identity for the database, and deployment uses GitHub OIDC.

## Frontend

The app is designed for a coach standing at a track in bright sun with one hand on a phone. That means large tap targets, high contrast, short flows, and no dependence on a keyboard.

### Routes

| Path | Screen | Auth | Purpose |
| --- | --- | --- | --- |
| `/` | Home | Yes | Recent sessions, outbox status, shortcuts to Import and Device check |
| `/signin`, `/auth/callback` | Sign-in | No | MSAL redirect flow |
| `/invite/:token` | Accept invite | Sign-in first | Join an organisation |
| `/athletes` | Athlete list | Yes | Search, add, consent status badge |
| `/athletes/new` | New athlete | Yes | Name, birth year, then consent step |
| `/athletes/:id` | Athlete profile | Yes | History, trends, consent, notes |
| `/athletes/:id/consent` | Record consent | Yes | Capture consent for analysis, clip storage and sharing |
| `/sessions/new` | New session | Yes | Pick athletes, mode, place, surface, footwear |
| `/sessions/:id` | Session | Yes | Clips and analyses in this session |
| `/import` | Import clips | Yes | Choose files, pick athlete and role (calibration or run) |
| `/analyse/:clipId` | Analyse | Yes | Calibrate, select athlete box, run, watch progress |
| `/analyses/:id` | Result viewer | Yes | Overlay video, events, metrics, notes |
| `/compare` | Before and after | Yes | Two analyses side by side, from query parameters |
| `/reports/:id` | Report builder | Yes | Choose frames and notes, export PDF, share link |
| `/device-check` | Device check | Yes | Verify a phone and its slow-motion mode |
| `/guide` | Capture guide | No | Setup checklist and run sheet, cached for offline |
| `/settings` | Settings | Admin | Organisation, members, invites, retention |
| `/r/:token` | Shared report | No | Public read-only report |

All routes except the public ones are lazy-loaded. Guard authenticated routes with a `RequireAuth` wrapper that also checks the organisation role from `/v1/me`.

### Key screens

**Import and calibrate.** The coach picks one calibration clip and one or more run clips from the phone. The app reads and shows the real frame rate, resolution, duration and codec for each. It shows the first frame of the calibration clip and asks the coach to tap marker 1 and marker 2, then confirm the real distance (default 5.00 m, editable). It shows the resulting scale and a pixel-length sanity warning if the two taps are very close. Then the coach drags a box around the athlete on a frame from each run clip. The box seeds the region-of-interest tracking.

**Analysis progress.** A full-screen job view with stage names (Reading video, Finding the athlete, Detecting steps, Calculating), a progress bar by frame, elapsed time, and a Cancel button. Keep the screen awake with the Screen Wake Lock API where available. If the tab is hidden, pause and resume with a clear message. On completion go to the result viewer, or show the quality gate failure with reasons and tips.

**Result viewer.** The main screen. Contents from top to bottom:

1. A canvas playing the clip with the skeleton drawn over it. Frame step buttons, slow-motion speeds (1/8, 1/4, 1/2, 1x), and keyboard arrows on desktop.
2. An event timeline under the video with markers for initial contact and toe-off, left and right in different colours. Tapping a marker jumps to that frame.
3. Angle read-outs for the current frame (knee, hip, shin, trunk lean).
4. Three auto-selected key frames (initial contact, mid-stance, toe-off) as tappable thumbnails.
5. Metric cards in two groups, higher confidence first. Each card shows the value, unit, left and right where relevant, a confidence badge and a one-line plain-language explanation.
6. A gate banner when the result passed with conditions, listing which metrics are hidden and why.
7. Coach notes, a Save button (disabled with an explanation if consent is missing), and a Report button.

**Compare.** Two analyses side by side with playback synchronised on the first initial contact of each. A table of metrics with the difference and the direction of change. A trend chart (Recharts) for any one metric across all of the athlete's sessions.

**Device check.** Pick a test clip. Show the detected frame rate, resolution, codec, timestamp regularity and duration. Show Pass, Conditional or Fail with the reason, and send the result with the phone model (from the user agent and a coach-entered model name) to the device-check endpoint.

### Components to build

`AppShell`, `BottomNav` (Home, Athletes, Guide, Settings), `OutboxPill` (saving, saved, offline, with a count, modelled on the Tournament Manager sync pill), `ClipPicker`, `ClipInfoCard`, `FrameCanvas`, `CalibrationOverlay`, `RoiSelector`, `SkeletonOverlay`, `EventTimeline`, `FrameScrubber`, `MetricCard`, `ConfidenceBadge`, `GateBanner`, `ConsentForm`, `ConsentBadge`, `JobProgress`, `EmptyState`, `ErrorState`, `ConfirmDialog`. Each has a story-style test page under `features/dev` that is excluded from production builds.

### State

| State | Home | Notes |
| --- | --- | --- |
| Server data | TanStack Query | Keys such as `['athletes']`, `['athlete', id]`, `['analysis', id]`. Mutations go through the outbox when offline |
| Analysis job | Zustand `jobStore` | Stage, progress, cancel token, result in memory. Not persisted until saved |
| Session and UI | Zustand `uiStore` | Selected athlete, active session, preferences |
| Offline writes | IndexedDB outbox | See the offline section |
| Auth | MSAL React context | Account and token acquisition |

### Design tokens

Stride sits under StatEdge Sport, which leads with orange. Put all values in `styles/tokens.css` as CSS custom properties, with a dark theme through `prefers-color-scheme` and a manual toggle.

| Token | Value | Use |
| --- | --- | --- |
| `--color-navy` | `#0D1C3E` | Backgrounds in dark mode, headings in light mode |
| `--color-orange` | `#F47820` | Primary actions, active states, left-foot markers can use the blue instead |
| `--color-blue` | `#1E4F8C` | Secondary actions, right-foot markers |
| Display font | Oswald | Headings and big numbers |
| Body font | Inter | Text and tables |
| Tap target | 48 px minimum | All buttons and list rows |
| Contrast | WCAG AA minimum, AAA for metric values | Readable in direct sun |

### Quality and accessibility rules

- Mobile first, designed at 360 px width, tested up to desktop. Landscape is supported on the result viewer.
- Every interactive element has an accessible name. Respect `prefers-reduced-motion`.
- Colour is never the only signal. Confidence badges have text, and left and right are labelled.
- All user-facing strings go through one `strings.ts` dictionary so that Afrikaans can be added later without a refactor.
- Every list and screen defines loading, empty and error states.

## Client analysis engine

The engine turns an imported clip into an `AnalysisResult` entirely on the phone. It is split into DOM-bound runtime code (decode, pose, worker glue) and pure code (clean, events, metrics, gate) so that everything after the pose step is testable on recorded keypoints.

&#91;embedded content: Analysis job pipeline: six stages in one worker\]

### Modules

| Module | Location | Needs DOM | Responsibility |
| --- | --- | --- | --- |
| `decoder.ts`, `fallbackDecoder.ts` | `analysis-runtime` | Yes | Demux and decode frames with timestamps. WebCodecs with `mp4box.js`, or `<video>` with `requestVideoFrameCallback` |
| `poseEstimator.ts` | `analysis-runtime` | Yes | The `PoseEstimator` interface |
| `mediapipeEstimator.ts` | `analysis-runtime` | Yes | MediaPipe Pose Landmarker implementation |
| `roi.ts` | `analysis-runtime` | Yes | Athlete box tracking and crop geometry |
| `jobRunner.ts`, `worker.ts`, `messages.ts` | `analysis-runtime` | Yes | Orchestration, cancellation, typed messages |
| `gaps.ts`, `filters.ts`, `orientation.ts` | `packages/analysis` | No | Gap filling, spike removal, low-pass filtering, facing direction |
| `events.ts` | `packages/analysis` | No | Stance detection and cross-check |
| `metrics.ts`, `confidence.ts` | `packages/analysis` | No | Metric formulas and confidence labels |
| `calibration.ts`, `gate.ts` | `packages/analysis` | No | Scale from marker taps, quality checks |
| `config.ts`, `types.ts` | `packages/analysis` | No | Tunable values and shared types |

### Core types

Landmark order follows MediaPipe Pose: 0 nose, 11 and 12 shoulders, 13 and 14 elbows, 15 and 16 wrists, 23 and 24 hips, 25 and 26 knees, 27 and 28 ankles, 29 and 30 heels, 31 and 32 foot index (left then right in each pair).

```ts
export type Side = 'left' | 'right';
export type Confidence = 'high' | 'medium' | 'low' | 'unavailable';

// x and y are full-frame pixels. v is visibility from 0 to 1.
export interface Landmark { x: number; y: number; v: number }

export interface PoseFrame {
  index: number;                // decoded frame index
  tSec: number;                 // time used for analysis
  landmarks: Landmark[] | null;  // 33 entries, null when no person was found
}

export interface ClipInfo {
  widthPx: number; heightPx: number; frameCount: number;
  declaredFps: number;          // chosen by the coach or the device profile
  containerTimesSec: Float64Array; // timestamps as stored in the file
  codec: string; durationSec: number;
}

export interface Calibration {
  markerA: { x: number; y: number };
  markerB: { x: number; y: number };
  distanceM: number;            // default 5
  pxPerM: number;
  backgroundSignature: Float32Array; // small grayscale thumbnail for movement checks
}

export interface StanceEvent {
  side: Side;
  icFrame: number; toFrame: number | null;
  icTimeSec: number; toTimeSec: number | null;
  agreement: 'both' | 'primary-only' | 'secondary-only';
}

export interface MetricResult {
  id: MetricId;
  value: number | null; unit: string;
  bySide?: { left: number | null; right: number | null };
  sd?: number; n: number;       // spread and number of cycles used
  confidence: Confidence;
  reasons: string[];            // plain-language reasons for a lowered label
}

export interface GateResult {
  status: 'pass' | 'conditional' | 'fail';
  checks: { id: string; ok: boolean; detail: string }[];
  hiddenMetrics: MetricId[];
}

export interface AnalysisResult {
  schemaVersion: 1;
  algorithmVersion: string;     // bump whenever any algorithm or config changes
  poseModel: { id: string; version: string };
  clip: Omit<ClipInfo, 'containerTimesSec'>;
  captureFps: number;
  direction: 1 | -1;            // 1 when travel is left to right in the image
  calibration: Omit<Calibration, 'backgroundSignature'>;
  events: StanceEvent[];
  metrics: MetricResult[];
  gate: GateResult; configSnapshot: AnalysisConfig;
  createdAt: string;            // ISO 8601, UTC
}

export interface PoseEstimator {
  readonly id: string; readonly version: string;
  init(signal?: AbortSignal): Promise<void>;
  estimate(frame: ImageBitmap, roi: Roi): Promise<Landmark[] | null>;
  dispose(): void;
}
```

### Stage 1: decode

- Prefer WebCodecs: demux with `mp4box.js`, check `VideoDecoder.isConfigSupported`, decode in order, and hand each `VideoFrame` on as an `ImageBitmap`. Close every frame and bitmap as soon as it has been used.
- If WebCodecs cannot decode the codec (for example HEVC on some phones), use the fallback: play the file in a `<video>` at a reduced `playbackRate` and read frames with `requestVideoFrameCallback`, de-duplicating on `mediaTime`. Record any gap larger than 1.5 times the median interval as a dropped frame.
- Time axis: if the container timestamps imply a rate of at least 100 fps with low jitter, use them. Otherwise use `index / declaredFps`. If neither is plausible, fail the gate with a frame-timing reason. Always keep the container timestamps, because video playback in the viewer needs them to map `mediaTime` to a frame index.
- Keep memory flat: stream frames through stages 1 and 2 and keep only landmarks.

### Stage 2: region of interest and pose

The athlete is small in the frame, so cropping to the athlete raises the effective resolution that the model sees.

- The coach draws an initial box on a frame. For each later frame the crop is a square around the bounding box of the previous frame's confident landmarks, enlarged by 40 percent, at least 384 px, clamped to the frame.
- Run the estimator in image mode on each crop, then map landmarks back to full-frame pixels. Image mode is used because the crop moves from frame to frame, which breaks the temporal tracker of video mode.
- If no person is found, retry once with the initial box enlarged by 50 percent. After more than a configured number of consecutive misses, stop and fail with a tracking-lost reason, reporting the frame range.
- Use the GPU delegate where available and fall back to CPU. The model files (`pose_landmarker_full.task` by default, with the heavy variant selectable) and the WASM runtime are self-hosted under `/models`.
- If a module worker cannot load MediaPipe in the chosen bundler setup, build the worker as a classic (IIFE) worker. This is a spike item.

### Stage 3: clean

Apply these steps to each landmark's x and y series, in this order:

1. Mark samples with visibility below `minVisibility` as missing.
2. Remove spikes with a Hampel filter (window and threshold in config).
3. Fill gaps up to `maxGapFrames` with a monotone cubic interpolation. Longer gaps stay missing and reduce confidence for any metric that needs the landmark.
4. Smooth with a zero-phase Butterworth low-pass filter (forward and backward passes, reflected edges). The cut-off is `lowPassHz.distance` or `lowPassHz.sprint`.
5. Estimate the direction of travel from the sign of the slope of the mid-hip x series. If travel is right to left, mirror x so that forward is always positive x in analysis. Store `direction` so that the viewer can draw the original orientation.

Side assignment: with a side-on camera one leg is near the camera and the other is partly hidden. If the athlete travels left to right, the camera sees the athlete's right side. If right to left, it sees the left side. Compare mean visibility of the left and right landmark groups with this expectation. If they disagree, mark left and right labelling as uncertain and cap any per-side metric at low confidence. Also check that the left and right ankle tracks do not swap labels mid-clip.

### Stage 4: events

Use two independent methods per side and record whether they agree.

**Primary, stance by foot speed.** For each frame take the lower of the heel and foot-index points as the contact point. Divide its speed and its height above the fitted ground line by the athlete's leg length (the median hip-to-ankle length over the clip), so the thresholds do not depend on how big the athlete is in the frame. A frame is in stance when speed is below `stanceSpeedLegPerSec` and height is below `groundBandLeg`. Fit the ground line robustly (for example RANSAC on the lowest foot points). The start of a run of stance frames is initial contact and the end is toe-off. Merge runs separated by fewer than two frames, and discard runs shorter than `minStanceMs` or longer than `maxStanceMs`.

**Secondary, Zeni-style.** Compute the horizontal position of the foot relative to the mid-hip. Peaks (foot furthest ahead) are initial contact candidates and troughs (foot furthest behind) are toe-off candidates.

An event is `both` when the two methods agree within `icToleranceMs` and `toToleranceMs`. The primary result is used as the event time, and the secondary one is only a cross-check. Events must alternate between feet. A broken alternation is recorded as a gate check.

Starting values for the thresholds, to be tuned in the spike, go in the config module: `stanceSpeedLegPerSec` 1.5, `groundBandLeg` 0.06, `minStanceMs` 50, `maxStanceMs` 400, `icToleranceMs` 25, `toToleranceMs` 35.

### Stages 5 and 6

Metric formulas and confidence rules are in the next section. The quality gate and calibration are in the section after that. Stage 6 runs checks both before analysis (clip level) and after it (event and metric level), and its output is the final `AnalysisResult`.

### Worker messages

Use one typed union, validated with zod in both directions. Progress messages are throttled to at most ten per second.

```ts
type ToWorker =
  | { type: 'start'; jobId: string; file: File; calibration: Calibration;
      roi: Roi; mode: 'sprint' | 'distance'; declaredFps: number; config: AnalysisConfig }
  | { type: 'cancel'; jobId: string };

type FromWorker =
  | { type: 'progress'; jobId: string; stage: Stage; fraction: number }
  | { type: 'done'; jobId: string; result: AnalysisResult; keypoints: ArrayBuffer }
  | { type: 'failed'; jobId: string; code: FailCode; detail: string };
```

### Performance targets (starting values)

- A 5-second clip at 240 fps (1,200 frames) finishes in under 90 seconds on the S23 Ultra, with the progress bar updating smoothly.
- Peak memory stays flat across clip length because frames are streamed and released.
- The UI thread never blocks for more than 50 ms while a job runs.
- If processing is too slow, the first lever is analysing every second frame in distance mode (120 effective fps). Sprint mode keeps every frame.

## Metrics and confidence

All metrics are computed from the cleaned track in analysis coordinates: forward is positive x, y points down, and the camera sees the athlete side-on. Angles are in degrees. Every metric is a pure function in `metrics.ts` that takes the track, events, calibration and config, and returns a `MetricResult`.

### Shared quantities

- **Leg length `L`:** the median over the clip of thigh length plus shank length (hip to knee plus knee to ankle) on the near side, in pixels. Convert to metres only where the calibration allows.
- **Mid-hip `M`:** the midpoint of the two hip landmarks. **Mid-shoulder `S`:** the midpoint of the two shoulder landmarks.
- **Contact point:** at each initial contact, the lower of the heel and foot-index points.
- **Cycle:** one stance from initial contact (IC) to toe-off (TO). A step is the time between consecutive ICs of opposite feet. A stride is the time between consecutive ICs of the same foot.

### Metric definitions

| Id | Definition | Unit | Per side | Needs |
| --- | --- | --- | --- | --- |
| `cadence` | 60 divided by the mean step time | steps per min | No | At least 3 ICs |
| `stride_frequency` | 1 divided by the mean stride time | Hz | Yes | At least 2 ICs per side |
| `contact_time` | Mean of TO time minus IC time | ms | Yes | IC and TO events |
| `flight_time` | Mean of next IC time (other foot) minus TO time | ms | No | IC and TO events |
| `step_length` | Horizontal travel of `M` between consecutive ICs, divided by `pxPerM` | m | No | Calibration, 3 ICs |
| `stride_length` | Horizontal travel of `M` between consecutive ICs of the same foot | m | Yes | Calibration |
| `speed` | Horizontal travel of `M` over the analysed events divided by elapsed time | m per s | No | Calibration |
| `overstride` | (contact point x minus `M` x at IC) divided by `L`, times 100. Positive when the foot lands ahead of the hips | % of leg length | Yes | IC events |
| `shin_angle_ic` | Angle of the vector from knee to ankle against vertical at IC. Positive when the ankle is ahead of the knee | deg | Yes | IC events |
| `knee_flexion_ic` | 180 minus the interior angle hip, knee, ankle at IC | deg | Yes | IC events |
| `hip_flexion_ic` | 180 minus the interior angle shoulder, hip, knee at IC | deg | Yes | IC events |
| `trunk_lean` | Angle of the vector from `M` to `S` against vertical, averaged over stance. Positive when leaning forward | deg | No | Shoulders and hips visible |
| `vertical_oscillation` | Mean peak-to-peak of the detrended `M` y over each stride, in cm and as a percentage of `L` | cm and % | No | Calibration for cm |
| `contact_asymmetry` | 100 times the absolute left-right difference in contact time, divided by their mean | % | No | Both sides, 2 cycles each |
| `step_time_asymmetry` | Same index, for the two step times | % | No | Both sides |
| `arm_swing_range` | Range of the upper-arm angle against vertical over each stride | deg | Yes | Shoulder and elbow visible |
| `foot_angle_ic` (experimental) | Angle of the heel to foot-index line against horizontal at IC | deg | Yes | Heel and foot index visible |

`foot_angle_ic` is behind a feature flag and off by default. Do not label a foot strike pattern in the MVP.

Display rounding: cadence and times to whole numbers, angles to 0.1 degrees, lengths to 0.01 m, percentages to 0.1.

### Metrics shown by mode

| Mode | Primary metrics | Secondary metrics |
| --- | --- | --- |
| Sprint | `stride_frequency`, `contact_time`, `flight_time`, `shin_angle_ic`, `trunk_lean`, `overstride` | `step_length`, `speed`, `knee_flexion_ic`, `arm_swing_range` |
| Distance | `cadence`, `overstride`, `trunk_lean`, `contact_asymmetry`, `vertical_oscillation` | `contact_time`, `knee_flexion_ic`, `step_time_asymmetry`, `speed` |

The lists live in config as `metricsByMode`, so that they can change without code edits.

### Confidence rules

The label comes from four measured qualities of the data actually used, then is capped by a ceiling for the metric.

- **Landmark quality `Ql`:** the fraction of frames in the used cycles where every landmark the metric needs has visibility at or above `minVisibility` (after gap filling).
- **Event quality `Qe`:** the fraction of the used events whose two detection methods agree.
- **Count `n`:** the number of cycles or events used.
- **Frame-rate adequacy:** whether the capture rate meets the metric's minimum.

| Label | Rule (starting values, in config) |
| --- | --- |
| High | `Ql` at least 0.90, `Qe` at least 0.80 where events are needed, `n` at least 3 per side (or 4 steps for whole-body metrics), frame rate adequate, near-side data |
| Medium | `Ql` at least 0.75, `Qe` at least 0.60, `n` at least 2 |
| Low | `Ql` at least 0.50, `n` at least 1 |
| Unavailable | Anything below that, or a required input is missing |

Ceilings by metric, regardless of data quality:

| Metric group | Ceiling | Reason |
| --- | --- | --- |
| `cadence`, `stride_frequency`, `trunk_lean`, angles at IC, `overstride` | High | Direct from landmarks and event timing |
| `contact_time`, `flight_time` | Medium, or High only when the capture rate is at least 200 fps and `Qe` is at least 0.80 | Sensitive to a one or two frame error in the event times |
| `step_length`, `stride_length`, `speed`, `vertical_oscillation` | Medium | Planar scale only. Assumes the athlete runs in the calibrated plane |
| `arm_swing_range`, `foot_angle_ic` | Low | Elbow, heel and toe landmarks are the least reliable |
| Any far-side metric | Medium | The far-side leg is partly hidden |
| Any per-side metric when side labelling is uncertain | Low | See side assignment in the analysis engine |

Each lowered label carries at least one plain-language reason in `reasons`, for example "Only 2 steps were visible" or "The far leg was partly hidden". The result viewer shows these under the badge.

### Spread

When `n` is at least 3, also return the standard deviation across cycles. The viewer shows value plus or minus spread on tap. Never hide a high spread: it is useful coaching information about consistency.

### Tests that come with the metrics

Build a synthetic gait generator in the test helpers. It produces a sequence of `PoseFrame` objects for a running skeleton with chosen cadence, contact time, leg length, trunk lean, knee angle and noise, including dropped landmarks. The tests assert that each metric is recovered within a stated tolerance across a range of noise levels, and that the confidence label falls as noise and gaps increase. Real recorded keypoints from the spike are added as fixtures afterwards.

## Calibration and quality gate

Calibration gives the analysis a real-world scale. The quality gate decides whether the result can be trusted, hides what it cannot defend, and tells the coach how to fix the shoot.

### Calibration

1. The coach imports a calibration clip: a static recording of about 3 seconds with the two markers on the lane centreline. The app shows its middle frame.
2. The coach taps marker A and marker B. Provide pinch zoom and a magnifier loupe so that taps are accurate in sunlight, and let the coach nudge each point.
3. The coach confirms the real distance between the markers. Default 5.00 m, editable.
4. The app computes `pxPerM` as the pixel distance between the taps divided by the distance in metres, and stores the taps, the distance and the scale in a `Calibration`.
5. It also stores a camera-stability signature: a small grayscale thumbnail (for example 128 by 72) of the calibration frame.

Validation on the taps:

- Warn if the pixel distance between the taps is under 20 percent of the frame width, because the scale will be less precise.
- Warn if the taps are not roughly level (vertical difference above 10 percent of the horizontal difference), because the markers should be at the same height in the image.
- Never silently assume a scale. Without a calibration, metrics that need it (`step_length`, `stride_length`, `speed`, `vertical_oscillation` in cm) are hidden and the result is at best conditional.

One calibration can serve many run clips from the same session if the camera did not move. Every run clip stores the identifier of the calibration it uses.

### Camera stability check

Compare the first frame of each run clip with the calibration thumbnail, with the athlete's box masked out, by phase correlation. Also compare the first and last frames of the run clip with each other. Report the shift in full-resolution pixels. Starting values: warn above 6 px, fail above 15 px. A fail means the camera moved or was panned. The message tells the coach to recalibrate.

### Gate checks

Checks run in two groups. Clip-level checks run before pose estimation so that a hopeless clip fails fast. Result-level checks run after it.

| Id | Group | What it checks | Warn | Fail |
| --- | --- | --- | --- | --- |
| `codec_decodable` | Clip | The file can be decoded |  | Cannot decode |
| `fps_ok` | Clip | Effective capture rate | Below 200 fps in sprint mode | Below 100 fps |
| `timing_regular` | Clip | Share of frame intervals more than 25 percent away from the median | Above 2 percent | Above 10 percent |
| `resolution_ok` | Clip | Frame height | Below 1080 px | Below 720 px |
| `duration_ok` | Clip | Clip length | Over 15 s | Under 1 s or over 30 s |
| `calibration_present` | Clip | Scale available | Missing (hides scaled metrics) |  |
| `athlete_selected` | Clip | A box was drawn |  | Missing |
| `camera_stable` | Clip | Shift against calibration and within the clip | Above 6 px | Above 15 px |
| `person_tracked` | Result | Share of frames with a pose | Below 0.90 | Below 0.60 |
| `body_visible` | Result | Share of frames with hips, knees and ankles of the near side visible | Below 0.85 | Below 0.50 |
| `athlete_size` | Result | Median height of the athlete in pixels | Below 200 px | Below 120 px |
| `feet_visible` | Result | Median visibility of heel and foot index | Below 0.60 | Below 0.40 |
| `steady_direction` | Result | Share of the clip where the hip moves consistently forward | Below 0.85 | Below 0.60 |
| `events_found` | Result | Initial contacts detected | Below 4 | Below 2 |
| `events_alternate` | Result | Share of events breaking left-right alternation | Above 10 percent | Above 30 percent |
| `method_agreement` | Result | Share of events where both methods agree | Below 0.60 |  |
| `timebase_plausible` | Result | Cadence between 100 and 330 steps per minute |  | Outside the range |
| `side_labels` | Result | Visibility pattern matches the direction of travel | Mismatch (caps per-side metrics at low) |  |

`timebase_plausible` catches a wrong frame rate: if the coach used Super slow-mo, or the file was re-timed, cadence comes out absurd and the gate says so instead of showing the numbers.

### Gate result

- **Fail:** any check fails. No metrics are shown and nothing can be saved or reported. The viewer lists the reasons with fix tips. The coach may keep the clip locally and try again.
- **Conditional:** no fails, but at least one warning. Metrics affected by a warning are hidden or have their confidence lowered, and a banner says which and why.
- **Pass:** no warnings.

Which warnings hide or cap which metrics is a lookup table in `gate.ts`, for example `calibration_present` hides `step_length`, `stride_length`, `speed` and the centimetre value of `vertical_oscillation`. `fps_ok` in sprint mode caps `contact_time` and `flight_time` at medium.

### Coach-facing tips

Each check id has a message and a fix tip in `strings.ts`. Examples:

| Check | Message and tip |
| --- | --- |
| `camera_stable` | The camera moved. Lock the tripod, then record the calibration clip again |
| `fps_ok` | This clip was not recorded at a high enough frame rate. Use Slow motion mode and check the screen shows 240 |
| `athlete_size` | The athlete is too small in the frame. Move the tripod closer |
| `body_visible` | Part of the body left the frame. Widen the shot or move the tripod back slightly |
| `steady_direction` | The athlete stopped or turned in the clip. Film a pass straight through the zone |
| `timebase_plausible` | The timing looks wrong. Check that you used Slow motion and not Super slow-mo, and that you imported the original file |

### Configuration shape

Keep every threshold above in one typed object, with a comment per value, so that tuning after the spike is a config change only.

```ts
export interface GateConfig {
  fps: { warnSprintBelow: number; failBelow: number };
  timing: { intervalTolerance: number; warnShare: number; failShare: number };
  resolution: { warnHeightBelow: number; failHeightBelow: number };
  durationSec: { min: number; warnOver: number; failOver: number };
  cameraShiftPx: { warn: number; fail: number };
  tracked: { warnBelow: number; failBelow: number };
  bodyVisible: { warnBelow: number; failBelow: number };
  athleteHeightPx: { warnBelow: number; failBelow: number };
  feetVisibility: { warnBelow: number; failBelow: number };
  steadyDirection: { warnBelow: number; failBelow: number };
  events: { warnBelow: number; failBelow: number; alternateWarn: number; alternateFail: number };
  agreementWarnBelow: number;
  cadenceSpm: { min: number; max: number };
}
```

## Data model

The database is Azure SQL (T-SQL). Every table that holds organisation data carries `org_id`, and row-level security enforces the boundary in the database as well as in the API. Migrations are numbered `.sql` files in `apps/api/migrations`, applied in order by a small script that records them in `stride.schema_migrations`.

### Entities

| Table | Purpose |
| --- | --- |
| `organisations` | A school, club or practice, with seat limit and retention setting |
| `coaches` | People who sign in, one organisation each in the MVP, with a role |
| `invites` | Pending invitations, stored as hashed tokens |
| `athletes` | People being analysed |
| `consents` | Who agreed to what, and when, with withdrawal |
| `sessions` | One capture occasion |
| `calibrations` | Marker taps and scale for a session |
| `clips` | Imported video metadata (the file itself stays on the phone by default) |
| `analyses` | The result JSON and the compressed raw keypoints |
| `analysis_metrics` | One row per metric, derived from the result for trend queries |
| `notes` | Coach notes on an analysis |
| `reports` | Private report snapshots |
| `shared_reports`, `shared_report_frames` | Public copies of a report, reachable only by token, no personal data beyond first name and initial |
| `device_checks` | Results of device checks |
| `device_profiles` | The tested compatible-phone list, maintained by StatEdge |
| `audit_log` | Who did what, and when |

### Schema

Starting DDL for migration `001`. Foreign keys do not cascade. Deleting an athlete goes through a stored procedure so that the order is explicit and audited.

```sql
CREATE SCHEMA stride;
GO

CREATE TABLE stride.organisations (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_organisations PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
  name NVARCHAR(200) NOT NULL,
  type VARCHAR(10) NOT NULL CONSTRAINT CK_org_type CHECK (type IN ('school','club','practice')),
  tournament_school_id UNIQUEIDENTIFIER NULL,   -- optional link to the Tournament Manager schools directory
  max_coaches INT NOT NULL CONSTRAINT DF_org_max DEFAULT 2,
  clip_retention_days INT NOT NULL CONSTRAINT DF_org_ret DEFAULT 90
    CONSTRAINT CK_org_ret CHECK (clip_retention_days BETWEEN 1 AND 365),
  created_at DATETIME2(0) NOT NULL CONSTRAINT DF_org_created DEFAULT SYSUTCDATETIME()
);

CREATE TABLE stride.coaches (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_coaches PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
  org_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_coaches_org REFERENCES stride.organisations(id),
  entra_oid UNIQUEIDENTIFIER NOT NULL CONSTRAINT UQ_coaches_oid UNIQUE,  -- 'oid' claim in the token
  email NVARCHAR(320) NOT NULL,
  display_name NVARCHAR(200) NULL,
  role VARCHAR(10) NOT NULL CONSTRAINT CK_coach_role CHECK (role IN ('admin','coach')),
  status VARCHAR(10) NOT NULL CONSTRAINT DF_coach_status DEFAULT 'active'
    CONSTRAINT CK_coach_status CHECK (status IN ('active','removed')),
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  last_seen_at DATETIME2(0) NULL
);

CREATE TABLE stride.invites (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
  org_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.organisations(id),
  email NVARCHAR(320) NOT NULL,
  role VARCHAR(10) NOT NULL CHECK (role IN ('admin','coach')),
  token_hash VARBINARY(32) NOT NULL,
  expires_at DATETIME2(0) NOT NULL,
  accepted_at DATETIME2(0) NULL,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES stride.coaches(id),
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_invites_token ON stride.invites(token_hash);

CREATE TABLE stride.athletes (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,                -- client-generated
  org_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.organisations(id),
  first_name NVARCHAR(100) NOT NULL,
  last_name NVARCHAR(100) NOT NULL,
  birth_year SMALLINT NOT NULL CHECK (birth_year BETWEEN 1940 AND 2100),
  external_ref NVARCHAR(50) NULL,                          -- the school's own athlete number
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES stride.coaches(id),
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_athletes_org_name ON stride.athletes(org_id, last_name, first_name);

CREATE TABLE stride.consents (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.organisations(id),
  athlete_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.athletes(id),
  purpose VARCHAR(12) NOT NULL CHECK (purpose IN ('analysis','clip_storage','sharing')),
  given_by VARCHAR(10) NOT NULL CHECK (given_by IN ('athlete','guardian')),
  given_by_name NVARCHAR(200) NOT NULL,
  relationship NVARCHAR(50) NULL,
  evidence VARCHAR(12) NOT NULL CHECK (evidence IN ('paper_form','digital','verbal')),
  given_on DATE NOT NULL,
  recorded_by UNIQUEIDENTIFIER NOT NULL REFERENCES stride.coaches(id),
  recorded_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  withdrawn_at DATETIME2(0) NULL
);
CREATE UNIQUE INDEX UX_consents_active ON stride.consents(athlete_id, purpose) WHERE withdrawn_at IS NULL;

CREATE TABLE stride.sessions (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.organisations(id),
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES stride.coaches(id),
  session_date DATE NOT NULL,
  place NVARCHAR(200) NULL,
  surface VARCHAR(12) NULL CHECK (surface IN ('track','grass','treadmill','road','other')),
  footwear NVARCHAR(100) NULL,
  mode VARCHAR(10) NOT NULL CHECK (mode IN ('sprint','distance')),
  notes NVARCHAR(1000) NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_sessions_org_date ON stride.sessions(org_id, session_date DESC);

CREATE TABLE stride.calibrations (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.organisations(id),
  session_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.sessions(id),
  distance_m DECIMAL(6,3) NOT NULL CHECK (distance_m > 0),
  marker_ax REAL NOT NULL, marker_ay REAL NOT NULL,
  marker_bx REAL NOT NULL, marker_by REAL NOT NULL,
  px_per_m REAL NOT NULL CHECK (px_per_m > 0),
  frame_width INT NOT NULL, frame_height INT NOT NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE stride.clips (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.organisations(id),
  session_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.sessions(id),
  athlete_id UNIQUEIDENTIFIER NULL REFERENCES stride.athletes(id),   -- null for calibration clips
  role VARCHAR(12) NOT NULL CHECK (role IN ('calibration','run')),
  calibration_id UNIQUEIDENTIFIER NULL REFERENCES stride.calibrations(id),
  device_model NVARCHAR(100) NULL,
  declared_fps SMALLINT NOT NULL, detected_fps REAL NULL,
  width_px INT NOT NULL, height_px INT NOT NULL,
  frame_count INT NOT NULL, duration_sec REAL NOT NULL,
  codec VARCHAR(30) NULL,
  direction SMALLINT NULL CHECK (direction IN (-1, 1)),
  storage_path NVARCHAR(400) NULL,           -- stretch: set only for opt-in uploads
  delete_after DATETIME2(0) NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_clips_session ON stride.clips(session_id);
CREATE INDEX IX_clips_athlete ON stride.clips(athlete_id);

CREATE TABLE stride.analyses (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.organisations(id),
  clip_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.clips(id),
  athlete_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.athletes(id),
  algorithm_version VARCHAR(30) NOT NULL,
  pose_model VARCHAR(60) NOT NULL,
  gate_status VARCHAR(12) NOT NULL CHECK (gate_status IN ('pass','conditional')),
  result_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(result_json) = 1),
  keypoints VARBINARY(MAX) NULL,             -- gzip of the SKP1 file, see below
  keypoints_bytes INT NULL,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES stride.coaches(id),
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  superseded_by UNIQUEIDENTIFIER NULL        -- set when re-analysed with a newer algorithm
);
CREATE INDEX IX_analyses_athlete ON stride.analyses(athlete_id, created_at DESC);

CREATE TABLE stride.analysis_metrics (
  analysis_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.analyses(id),
  org_id UNIQUEIDENTIFIER NOT NULL,
  metric_id VARCHAR(40) NOT NULL,
  value REAL NULL, left_value REAL NULL, right_value REAL NULL, sd REAL NULL,
  n SMALLINT NOT NULL, unit VARCHAR(16) NOT NULL,
  confidence VARCHAR(12) NOT NULL CHECK (confidence IN ('high','medium','low','unavailable')),
  CONSTRAINT PK_analysis_metrics PRIMARY KEY (analysis_id, metric_id)
);

CREATE TABLE stride.notes (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL,
  analysis_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.analyses(id),
  coach_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.coaches(id),
  body NVARCHAR(2000) NOT NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE stride.reports (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL,
  athlete_id UNIQUEIDENTIFIER NOT NULL REFERENCES stride.athletes(id),
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES stride.coaches(id),
  title NVARCHAR(200) NOT NULL,
  snapshot_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(snapshot_json) = 1),
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Public copies. No org_id predicate: protected by an unguessable token. First name and initial only.
CREATE TABLE stride.shared_reports (
  token_hash VARBINARY(32) NOT NULL PRIMARY KEY,
  report_id UNIQUEIDENTIFIER NOT NULL,
  org_id UNIQUEIDENTIFIER NOT NULL,
  snapshot_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(snapshot_json) = 1),
  expires_at DATETIME2(0) NOT NULL,
  revoked_at DATETIME2(0) NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE stride.shared_report_frames (
  token_hash VARBINARY(32) NOT NULL REFERENCES stride.shared_reports(token_hash),
  ordinal TINYINT NOT NULL, label VARCHAR(30) NOT NULL, jpeg VARBINARY(MAX) NOT NULL,
  CONSTRAINT PK_shared_frames PRIMARY KEY (token_hash, ordinal)
);

CREATE TABLE stride.device_profiles (            -- maintained by StatEdge, readable by all
  id INT IDENTITY PRIMARY KEY,
  model NVARCHAR(100) NOT NULL, tier CHAR(1) NOT NULL CHECK (tier IN ('A','B','C')),
  max_slowmo NVARCHAR(60) NULL, notes NVARCHAR(400) NULL,
  updated_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE stride.device_checks (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL,
  device_model NVARCHAR(100) NULL, os NVARCHAR(50) NULL, browser NVARCHAR(100) NULL,
  declared_fps SMALLINT NULL, detected_fps REAL NULL,
  width_px INT NULL, height_px INT NULL, codec VARCHAR(30) NULL, timing_jitter REAL NULL,
  result VARCHAR(12) NOT NULL CHECK (result IN ('pass','conditional','fail')),
  reason NVARCHAR(400) NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE stride.audit_log (
  id BIGINT IDENTITY PRIMARY KEY,
  org_id UNIQUEIDENTIFIER NOT NULL,
  coach_id UNIQUEIDENTIFIER NULL,
  action VARCHAR(40) NOT NULL,
  target_type VARCHAR(30) NULL, target_id UNIQUEIDENTIFIER NULL,
  detail NVARCHAR(500) NULL,
  at DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_audit_org_time ON stride.audit_log(org_id, at DESC);
```

### Row-level security

The API sets the organisation for the connection before any query. With no context set, the predicate returns no rows, so a bug fails closed.

```sql
CREATE SCHEMA security;
GO
CREATE FUNCTION security.fn_org_predicate(@org_id UNIQUEIDENTIFIER)
RETURNS TABLE WITH SCHEMABINDING AS
  RETURN SELECT 1 AS allowed
  WHERE @org_id = TRY_CAST(SESSION_CONTEXT(N'org_id') AS UNIQUEIDENTIFIER);
GO
-- Repeat the filter and block predicates for every table that has org_id:
-- coaches, invites, athletes, consents, sessions, calibrations, clips, analyses,
-- analysis_metrics, notes, reports, device_checks, audit_log. organisations uses its id column.
CREATE SECURITY POLICY security.org_isolation
  ADD FILTER PREDICATE security.fn_org_predicate(org_id) ON stride.athletes,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.athletes AFTER INSERT,
  ADD BLOCK PREDICATE security.fn_org_predicate(org_id) ON stride.athletes AFTER UPDATE
  -- ...one trio per table...
  WITH (STATE = ON);
```

Connection handling rules for `apps/api/src/lib/db.ts`:

- Expose one function, `withOrg(orgId, fn)`. It takes a connection from the pool, runs `EXEC sp_set_session_context @key = N'org_id', @value = @orgId`, runs `fn`, then sets the value back to `NULL` before releasing the connection. No other code path may query org-scoped tables.
- Do not rely on the context surviving pool reuse. Set it every time.
- A test asserts that a query without `withOrg` returns zero rows, and that a query in one organisation's context never returns another's rows.
- The public share endpoint and the device profile list read tables without RLS (`shared_reports`, `device_profiles`) through a separate `withoutOrg` helper.

### Deleting an athlete

Implement `stride.delete_athlete @athlete_id` as a stored procedure. In one transaction, in this order: delete `shared_report_frames` and `shared_reports` for the athlete's reports, `reports`, `notes`, `analysis_metrics`, `analyses`, `clips` that belong to the athlete, `consents`, then the `athletes` row, and write an `audit_log` row. Blob files for the athlete's clips are deleted by the API afterwards (stretch milestone).

### Keypoint file format (SKP1)

Store the raw, uncleaned landmarks so that results can be re-computed with a newer algorithm without the video. The viewer re-runs the pure clean stage using the configuration snapshot stored in the result JSON. Add `configSnapshot` (the full analysis config used) to `AnalysisResult` for this reason.

| Offset | Type | Content |
| --- | --- | --- |
| 0 | 4 bytes ASCII | `SKP1` |
| 4 | uint16 | Format version, currently 1 |
| 6 | uint32 | Frame count |
| 10 | uint8 | Landmark count (33) |
| 11 | uint16 | Frame width in pixels |
| 13 | uint16 | Frame height in pixels |
| 15 | uint8 | Flags, bit 0 set when the analysis mirrored the x axis |
| 16 | float32 array | Container timestamp in seconds for each frame |
| After that | per frame, per landmark | x as uint16 (x divided by width times 65535), y as uint16, visibility as uint8 (times 255) |

A missing landmark has visibility 0 and x and y equal to 65535. All values are little-endian. The whole file is gzip-compressed (`CompressionStream` in the browser, `zlib` in Node) before upload and kept as `VARBINARY(MAX)`. A 1,200-frame clip is about 200 KB uncompressed, so well within the free database size for hundreds of analyses. Write a round-trip test that encodes and decodes a random pose sequence and asserts that the error is below one pixel.

## API

The API is a set of Azure Functions HTTP triggers under `/api/v1`, registered with the v4 programming model (`app.http`) with `authLevel: 'anonymous'`. Authentication is done by our own middleware that validates the Entra token, because the token must be mapped to a coach and organisation in the database. Request and response bodies are defined once as zod schemas in `packages/shared`.

### Endpoints

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /v1/health` | None | Status and build version. Does not touch the database |
| `GET /v1/me` | Token | Coach, organisation, role, seats used, retention setting |
| `PATCH /v1/org` | Admin | Update organisation settings (retention days) |
| `GET /v1/org/members` | Admin | List coaches |
| `DELETE /v1/org/members/{coachId}` | Admin | Remove a coach and free a seat |
| `POST /v1/org/invites` | Admin | Create an invite. Returns a link containing the token, shown once |
| `POST /v1/invites/accept` | Token | Accept an invite and create the coach record |
| `GET /v1/athletes` | Coach | List with `q`, `cursor`, `limit` |
| `PUT /v1/athletes/{id}` | Coach | Create or update, client-generated UUID |
| `GET /v1/athletes/{id}` | Coach | One athlete with consent summary |
| `DELETE /v1/athletes/{id}` | Admin | Hard delete everything for the athlete. Body must repeat the athlete's name |
| `GET /v1/athletes/{id}/consents` | Coach | Consent history |
| `PUT /v1/consents/{id}` | Coach | Record a consent. Immutable once written |
| `POST /v1/consents/{id}/withdraw` | Coach | Withdraw a consent |
| `GET /v1/sessions` | Coach | List with `athleteId`, `from`, `to`, `cursor` |
| `PUT /v1/sessions/{id}` | Coach | Create or update |
| `GET /v1/sessions/{id}` | Coach | Session with clips and analysis summaries |
| `PUT /v1/calibrations/{id}` | Coach | Store marker taps and scale |
| `PUT /v1/clips/{id}` | Coach | Store clip metadata |
| `GET /v1/clips/{id}` | Coach | Clip metadata |
| `PUT /v1/analyses/{id}` | Coach | Store a result. Server re-validates, enforces consent and gate status, writes metric rows |
| `PUT /v1/analyses/{id}/keypoints` | Coach | Upload the gzip SKP1 file as `application/octet-stream` |
| `GET /v1/analyses/{id}` | Coach | Result JSON and notes |
| `GET /v1/analyses/{id}/keypoints` | Coach | Download the keypoint file |
| `GET /v1/athletes/{id}/analyses` | Coach | History with metric rows, for trends |
| `DELETE /v1/analyses/{id}` | Coach | Delete one analysis |
| `PUT /v1/notes/{id}`, `DELETE /v1/notes/{id}` | Coach | Coach notes |
| `PUT /v1/reports/{id}` | Coach | Store a report snapshot |
| `PUT /v1/reports/{id}/frames/{ordinal}` | Coach | Upload a key-frame JPEG (at most 5 per report) |
| `GET /v1/reports/{id}` | Coach | Report snapshot |
| `POST /v1/reports/{id}/share` | Coach | Create a public copy. Needs sharing consent. Returns the link once |
| `DELETE /v1/reports/{id}/share` | Coach | Revoke the public copy |
| `GET /v1/public/reports/{token}` | None | Public report snapshot |
| `GET /v1/public/reports/{token}/frames/{ordinal}` | None | Public key-frame image |
| `POST /v1/device-checks` | Coach | Record a device check |
| `GET /v1/device-profiles` | None | The tested compatible-phone list, cacheable |
| GET /v1/athletes/{id}/export | Admin | Everything held about one athlete as JSON, for a data access request |

### Authentication and authorisation

- Validate the bearer token with `jose` using the External ID tenant's JWKS (cached): signature, issuer, audience equal to `ENTRA_API_AUDIENCE`, expiry, and the `access_as_user` scope.
- Read the `oid` claim and load the coach by `entra_oid` (cache for about 60 seconds per instance). Unknown user: `403` with code `not_enrolled`, which sends the web app to the invite flow. A removed coach gets `403 forbidden`.
- Roles are `admin` and `coach`, read from the database, never from the token. A helper `requireRole('admin')` guards admin routes.
- Every database call goes through `withOrg(coach.orgId, ...)` so row-level security applies.
- Platform administration (creating organisations, maintaining device profiles) is done by scripts run by StatEdge staff with their own Entra identity, not through the public API.

### Server-side rules that must not depend on the client

- **Consent:** `PUT /analyses/{id}` requires an active `analysis` consent for the athlete. If the athlete is a minor (current year minus birth year is 18 or less, deliberately conservative), the consent must have `given_by = 'guardian'`. Otherwise return `422` with code `consent_required`.
- **Gate:** reject results whose `gate.status` is `fail`, with code `gate_failed`.
- **Plausibility:** reject metric values outside generous physical ranges, unknown metric ids, and a `schemaVersion` the server does not support.
- **Sharing:** `POST /reports/{id}/share` requires an active `sharing` consent. The public copy contains first name and last initial only, never the full name, birth year or notes marked private.
- **Seats:** accepting an invite fails with `seat_limit` when the organisation has no free seat.
- **Sizes:** JSON bodies up to 256 KB. Keypoint files up to 5 MB compressed, and the decompressed size must be checked while streaming (stop at 20 MB) to defeat decompression bombs. Frame images up to 300 KB.

### Errors

Return RFC 9457 `application/problem+json` with `type`, `title`, `status`, `detail`, a stable `code` and, for validation failures, an `errors` array of `{ path, message }`.

| Code | Status | When |
| --- | --- | --- |
| `unauthorised` | 401 | Missing or invalid token |
| `not_enrolled` | 403 | Valid token, no coach record |
| `forbidden` | 403 | Role or organisation does not allow it |
| `validation` | 400 | Body or query failed the schema |
| `not_found` | 404 | No such resource in this organisation |
| `conflict` | 409 | Immutable resource written again with different content |
| `consent_required` | 422 | Consent missing or not from a guardian for a minor |
| `gate_failed` | 422 | Result did not pass the quality gate |
| `seat_limit` | 422 | No free coach seats |
| `payload_too_large` | 413 | Body over the limit |
| `rate_limited` | 429 | Too many requests |
| `internal` | 500 | Unexpected. Return a request id, never internals |

### Idempotency, pagination and concurrency

- Every create is a `PUT` with a client-generated UUID. Repeating the same request returns `200` with the same resource. The first write returns `201`. Writing an immutable resource (analysis, consent) again with different content is a `409`.
- Lists use cursor pagination with an opaque cursor. Default limit 25, maximum 100. Responses are `{ items, nextCursor }`.
- Mutable resources (athlete, session, note) use last write wins. This is a conscious choice for the MVP, because one coach normally edits their own records.

### Cross-cutting

- **CORS:** allow only the origins in `ALLOWED_ORIGINS`, the `Authorization` and `Content-Type` headers, and the methods above. No cookies.
- **Rate limiting:** a simple per-instance token bucket (for example 120 requests per minute per coach, 60 per minute per IP on public routes). This is best effort on the Consumption plan and is documented as such.
- **Logging:** structured JSON with request id, route, status, duration, organisation id and coach id. Never log request bodies, names or tokens.
- **Share tokens:** 32 random bytes, base64url. Only the SHA-256 hash is stored. Default expiry 30 days, maximum 90.
- **OpenAPI:** generate `openapi.json` from the zod schemas in CI and publish it as a build artefact. The web client is a small hand-written typed wrapper that reuses the same schemas.

## Auth, roles, consent and retention

### Entra External ID setup (one time, manual)

The external tenant and its app registrations are created once by hand and documented in the repository. The Terraform azurerm provider does not manage the external tenant.

1. Create an Entra External ID external tenant for StatEdge customers.
2. Register a single-page application `stride-web` with redirect URIs for the production origin, the dev origin and `http://localhost:5173`, each ending in `/auth/callback`.
3. Register an API `stride-api` that exposes the scope `access_as_user`, with access token version 2.
4. Create a sign-up and sign-in user flow with email one-time passcode. Social sign-in (Google, Microsoft) is optional. Add the `email` optional claim to tokens.
5. Apply StatEdge branding (logo, navy and orange) to the sign-in pages.

In the web app, configure `@azure/msal-browser` with the tenant's `ciamlogin.com` authority and request the scope `api://<api-client-id>/access_as_user`. Use the redirect flow, not popups, because mobile browsers handle popups badly. Cache tokens in `localStorage` so that the installed PWA keeps the coach signed in, and rely on the strict content security policy to limit script injection risk. Refresh tokens for single-page apps expire after a fixed period, so expect a coach to sign in again about once a day while online. Local analysis must keep working without a valid token, and only saving needs one.

### Roles

| Role | Can do |
| --- | --- |
| `coach` | Everything for athletes, sessions, clips, analyses, notes and reports in their organisation |
| `admin` | Everything a coach can do, plus invite and remove coaches, change retention, and delete athletes |

StatEdge staff manage organisations and the device profile list with scripts, not through the app.

### Onboarding flows

- **New organisation:** run `scripts/create-org.ts` with the name, type, first admin email and seat limit. It creates the organisation and prints an admin invite link.
- **Invite:** an admin enters an email and role. The API stores a hashed token and returns a link such as `/invite/{token}` to copy and send by WhatsApp or email. Sending email from the app is out of scope for the MVP.
- **Accept:** the invited person opens the link, signs in or signs up with the same email, and the web app calls `POST /v1/invites/accept`. The API checks the token hash, the expiry (7 days), that it has not been used, that the token's email claim matches the invite, and that a seat is free. Seats used are active coaches plus pending invites.
- **Remove:** an admin marks a coach as removed. Their analyses stay with the organisation.

### Consent rules

| Rule | Detail |
| --- | --- |
| Purposes | `analysis` is needed to analyse and save. `sharing` is needed to create a public link. `clip_storage` is needed to upload a clip (stretch) |
| Who consents | The athlete if aged 18 or over. A parent or guardian if under 18. The app treats an athlete as a minor when the current year minus the birth year is 18 or less |
| Evidence | `paper_form` means the coach attests that a signed form is on file. `digital` is reserved for a later guardian sign-off link. `verbal` is allowed only for adult athletes |
| Block before analysis | The analyse screen will not start for an athlete who has no active `analysis` consent. Device check has no athlete and is not blocked |
| Withdrawal | Marks the consent withdrawn and blocks future saves. A request to delete data removes everything through the delete-athlete procedure, after the admin confirms by typing the athlete's name |
| Export | `GET /v1/athletes/{id}/export` (admin) returns the athlete, consents, sessions, metrics and notes as JSON for a data access request. |

The app links a downloadable consent form template from `/public`. The wording must be supplied and reviewed by a POPIA practitioner before the pilot. The template states what is collected, why, how long it is kept, who sees it, how to withdraw, and who to contact. A privacy notice link appears in the footer and during onboarding, and it must name that coach email and name are held by the sign-in service outside South Africa.

Coach notes are free text and may contain health information by accident. Show a short hint under the note field: do not enter medical details.

### Retention

| Data | Rule |
| --- | --- |
| Local clips on the phone (OPFS library) | Deleted on app start once older than the organisation's `clip_retention_days`. A button removes all clips from the device |
| Uploaded clips (stretch) | `delete_after` is set at upload. The daily sweep deletes the file and clears `storage_path` |
| Analyses, metrics, notes | Kept until deleted, or until the athlete is deleted |
| Shared reports | Expire (default 30 days, maximum 90). The sweep deletes expired and revoked copies |
| Invites | Expired invites are deleted by the sweep |
| Audit log | Kept 24 months, then deleted by the sweep. Value in config |

Implement the sweep as a timer-triggered function that runs daily, `retention-sweep`, with a cron schedule of `0 0 * * *` (00:00 UTC, 02:00 in South Africa). It runs per organisation inside `withOrg`, logs counts only, and writes one audit row with the numbers deleted.

### Audit log

Write an audit row for: `athlete.create`, `athlete.delete`, `consent.record`, `consent.withdraw`, `analysis.save`, `analysis.delete`, `report.create`, `share.create`, `share.revoke`, `export.athlete`, `member.invite`, `member.remove`, `retention.sweep`. Reads are not audited in the MVP because of volume and the free database limits. Expose the log to admins as a simple read-only list in settings.

## Offline, PWA and local storage

Tracks often have poor signal, so the core loop (import, calibrate, analyse, review) must work with no network, and saving must catch up later without losing anything.

### PWA setup

- Use `vite-plugin-pwa` (Workbox) with `registerType: 'prompt'`. Show a "New version available, reload" message and never reload during an analysis job.
- Manifest: name `StatEdge Stride`, short name `Stride`, `display: standalone`, theme and background colour navy `#0D1C3E`, icons at 192 and 512 px plus a maskable icon.
- Precache the app shell, fonts, the capture guide route and static strings. Do not precache the pose model at install, because it is large.
- Pose model and WASM files use a `CacheFirst` runtime route in a cache named `models-v1`, with versioned file names so that updates are explicit. A "Prepare for offline" button on the home screen downloads them with a progress bar and shows "Ready for offline". Encourage coaches to do this on Wi-Fi.
- Call `navigator.storage.persist()` after install.
- On iOS there is no install prompt, so show short instructions to add the app to the Home Screen. Installing matters because Safari may clear storage for sites that are not installed after a period of inactivity (to be verified in the spike).
- Run a capability check on first launch and list anything missing: Web Workers, WebCodecs, WebGL2 or WebGPU, OPFS, `CompressionStream`, Screen Wake Lock. Missing WebCodecs falls back to the video-element decoder. Anything else missing shows a clear message.

### What is cached where

| Data | Where | Notes |
| --- | --- | --- |
| App shell, fonts, guide | Service worker precache | Static, no personal data |
| Pose model and WASM | Cache API, `models-v1` | Fetched on demand or by "Prepare for offline" |
| Athletes, sessions, recent analyses | IndexedDB through the TanStack Query persister | Personal data. Never put it in the service worker cache. Cleared on sign-out |
| Pending writes | IndexedDB `outbox` store | See below |
| Imported run clips | OPFS `/clips/{clipId}` | Optional copy, see below |
| Key-frame thumbnails | IndexedDB | Three small JPEGs per analysis |

On a shared or rented phone, sign-out must clear the persisted query cache, the outbox (after warning if it is not empty), key-frame thumbnails and the OPFS clip library.

### Outbox

Every write to the API goes through the outbox, whether the phone is online or not. The UI updates optimistically.

```ts
interface OutboxEntry {
  id: string;                  // uuid, also the idempotency key of the PUT
  createdAt: string;
  method: 'PUT' | 'POST' | 'DELETE';
  path: string;
  body: unknown | Blob;        // keypoint files are stored as Blob
  dependsOn: string[];         // ids that must succeed first
  state: 'pending' | 'sending' | 'failed' | 'done';
  attempts: number;
  lastError?: { code: string; detail: string };
}
```

Rules:

- Flush in creation order, honouring `dependsOn`, because an analysis cannot be saved before its athlete, session, calibration and clip exist.
- Permanent errors (`validation`, `consent_required`, `gate_failed`, `conflict`, `forbidden`) mark the entry `failed` and surface it in the UI with the reason and the actions View, Retry and Discard. They never retry automatically.
- A `401` pauses the queue until the coach signs in again. Network errors and `5xx` retry with exponential backoff (1 s doubling to 60 s) plus jitter.
- Flush on app start, when the browser fires `online`, on `visibilitychange` to visible, after each enqueue and from a "Sync now" button. iOS has no background sync, so syncing happens only while the app is open.
- `OutboxPill` shows Saved, Saving (with count), Offline (with count) or Needs attention.
- Because all creates are idempotent `PUT`s with client-generated UUIDs, a repeated send after a lost response is safe.

### Local clip library (OPFS)

On import, the app can keep a copy of each run clip in the Origin Private File System so that the result viewer can play it later even if the original has been moved or deleted from the gallery.

- Setting: "Keep a copy in the app", on by default for run clips. Calibration clips keep only a JPEG of the chosen frame and the signature, then the copy is dropped.
- Show storage used from `navigator.storage.estimate()` and warn at 80 percent of the quota.
- Where `createWritable` is not available, write through a worker using `createSyncAccessHandle`. If OPFS is unavailable altogether, fall back to IndexedDB blobs, or to asking the coach to pick the original file again. Store a `fingerprint` (SHA-256 of the first megabyte plus size) so that the app can recognise the same file. Add a `fingerprint CHAR(64) NULL` column to `clips` in migration 001.
- If the clip is not on the device when a result is opened, show the key frames and metrics and offer "Pick the original clip to play it", matched by fingerprint.
- Delete copies after the organisation's retention period, and let the coach delete any clip.

### Resumable jobs (should have)

Phones suspend background tabs, and iOS in particular may stop a job when the screen locks. Checkpoint the raw landmarks to IndexedDB every 100 frames. If a job is interrupted, offer "Resume analysis" from the last checkpoint. Request the Screen Wake Lock while a job runs, and show a clear message if the tab went to the background.

### Supported environments

| Target | Minimum | Notes |
| --- | --- | --- |
| Android Chrome | Current and previous major version | The S23 Ultra is the reference device |
| iOS Safari, installed PWA | iOS 16.4 or later (verify WebCodecs and OPFS behaviour in the spike) | Second target |
| Desktop Chrome, Edge | Current | For development and for coaches reviewing results |

Do not promise support for any browser that fails the capability check.

## Reports and sharing

A report is a short, readable summary of one analysis, or a before-and-after comparison of two, that a coach can give to an athlete, a parent or a physio. It is produced as a PDF on the phone, and optionally as a private link.

### Report builder

The builder screen at `/reports/:id` lets the coach:

1. Choose the analysis, or two analyses of the same athlete and mode for a comparison.
2. Choose three to five key frames. The three automatic frames (initial contact, mid-stance, toe-off) are always available.
3. Choose which coach notes to include.
4. Choose the name style: first name and last initial (default) or full name.
5. Preview the PDF, then download it or send it with the Web Share API (`navigator.share` with a file), falling back to a download.

Key frames are rendered on a canvas at 1280 px wide with the skeleton overlay and a caption, then encoded as JPEG at quality 0.8 and kept under 300 KB. At the end of every analysis, generate and store the three automatic key frames in IndexedDB. Any other frame needs the clip to be present on the device.

### PDF layout (A4 portrait)

Generate with `jspdf` and `jspdf-autotable`, imported dynamically so they stay out of the initial bundle.

| Area | Content |
| --- | --- |
| Header | StatEdge Stride wordmark, organisation name, report title, orange rule |
| Athlete block | Name (per the chosen style), date, place, mode, surface, footwear |
| Key frames | Three to five frames in a strip, each with a caption such as "Right foot, initial contact" |
| Primary metrics | Table: metric, value, left, right, confidence, one-line description |
| Secondary metrics | Same table, grouped separately |
| Comparison (optional) | Metric, earlier value, later value, change, with a note if the calibration or mode differs |
| Coach notes | The selected notes, with date |
| How to read this | What the confidence labels mean, and that hidden metrics were hidden because the data was not good enough |
| Disclaimer | "This report describes movement measured from a single side-on video. It is a coaching aid, not a medical assessment, and it does not diagnose or predict injury." |
| Footer | Algorithm version, date generated, page numbers |

Content rules:

- One plain-language description per metric lives in `strings.ts`, written as a description of what is measured, for example "How far ahead of the hips the foot lands, as a share of leg length."
- Do not show target ranges, red or green colouring, or any good or bad judgement in the MVP. The app has no validated norms for school athletes. Interpretation comes from the coach's own notes.
- Hidden metrics are not shown as blanks. List them once under "Not measured in this clip" with the reason.
- Text in the PDF is selectable. Use the body font Inter and Oswald for headings, embedded as base64 subsets where the PDF library requires it.

### Report snapshot

The snapshot is what is stored and shared. It contains results only, never raw keypoints, birth year or full names unless the coach chose the full-name style for the PDF (the shared copy always uses first name and initial).

```ts
interface ReportSnapshot {
  schemaVersion: 1;
  title: string;
  organisationName: string;
  athleteDisplayName: string;      // first name and last initial
  session: { date: string; place?: string; mode: 'sprint' | 'distance'; surface?: string };
  analyses: { id: string; createdAt: string; algorithmVersion: string;
              gateStatus: 'pass' | 'conditional'; metrics: MetricResult[];
              hiddenReasons: string[] }[];
  comparison?: { baselineAnalysisId: string; laterAnalysisId: string; caveats: string[] };
  notes: { text: string; createdAt: string }[];
  frames: { ordinal: number; label: string; caption: string }[];
  generatedAt: string;
}
```

### Share links

- Creating a link needs an internet connection and an active `sharing` consent. The button is disabled offline with an explanation.
- Sequence: `PUT /v1/reports/{id}`, then `PUT /v1/reports/{id}/frames/{n}` for each frame, then `POST /v1/reports/{id}/share`. The response contains the URL once, in the form `https://<web-origin>/r/{token}`. Show it with Copy and Share buttons and a reminder that anyone with the link can see the report.
- The API stores only the hash of the token and copies the snapshot and frames into `shared_reports` and `shared_report_frames`.
- The coach can revoke the link at any time, which deletes the public copy. Expired and revoked links look identical to links that never existed: the viewer shows "This link is no longer available." so that tokens cannot be probed.
- Default expiry 30 days, maximum 90 days, shown on the report screen.

### Public report viewer (`/r/:token`)

- Read-only, mobile friendly, no sign-in, no cookies, no analytics and no third-party requests.
- Shows the athlete's first name and initial, the date, the key frames, the primary metrics with confidence labels and descriptions, the selected notes, the expiry date and the disclaimer.
- Served with `X-Robots-Tag: noindex`, a `noindex` meta tag, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on the API responses.
- Does not load the pose model or any analysis code. Use a small separate route bundle so that the page is quick on a parent's phone.

### Tests

- Generate a PDF from a fixed snapshot in a test, extract its text with `pdfjs-dist`, and assert that the disclaimer, the metric names, the confidence labels and the page footer are present, and that no hidden metric value appears.
- Assert that a shared snapshot never contains a full name, a birth year or an unselected note.
- End-to-end: create a link, open it in a fresh browser context without sign-in, revoke it, and confirm that the page then shows the unavailable message.

## Security, privacy and observability

Stride holds data about children, so the defaults must be safe without anyone having to remember to switch things on.

### Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| One organisation reading another's data | Organisation scoping in every API query, plus row-level security in the database, plus automated tests that try to cross the boundary |
| Script injection stealing tokens | React escaping, no `dangerouslySetInnerHTML`, strict content security policy, no third-party scripts |
| Stolen or shared phone | Sign-out wipes cached data, outbox, thumbnails and the clip library. Encourage a device lock. Rental phones are wiped between hires |
| Leaked share link | Random 32-byte token, hash stored, expiry, one-click revoke, minimal content, `noindex` |
| Forwarded invite link | The invite is bound to an email address and checked against the token's email claim. It expires in 7 days and works once |
| Malicious upload | Size limits, content-type checks, JPEG magic-byte check for frames, header and size check on decompressed keypoints, streaming decompression with a cap. Uploaded files are never served from the app origin |
| SQL injection | Parameterised queries only. A lint rule forbids string-built SQL |
| Abuse of public routes | Unguessable tokens, uniform not-found responses, best-effort rate limits |
| Supply chain | Lock file, `pnpm install --frozen-lockfile`, `pnpm audit` and dependency updates in CI, licence check, GitHub Actions pinned by commit hash |
| Wrong or misleading result | Quality gate, confidence labels, no norms or good and bad colouring, a visible disclaimer |

### Headers and content security policy

Set response headers for the web app in `staticwebapp.config.json`. Self-host fonts, models and scripts so that no third-party origin is needed.

```json
{
  "globalHeaders": {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' https://<api-host> https://<tenant>.ciamlogin.com https://*.in.applicationinsights.azure.com; frame-src https://<tenant>.ciamlogin.com; form-action 'self' https://<tenant>.ciamlogin.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
  },
  "routes": [
    { "route": "/r/*", "headers": { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } },
    { "route": "/models/*", "headers": { "Cache-Control": "public, max-age=31536000, immutable" } }
  ],
  "navigationFallback": { "rewrite": "/index.html", "exclude": ["/models/*", "/assets/*"] }
}
```

The `'wasm-unsafe-eval'` source is needed for the MediaPipe WASM runtime. The exact policy, in particular for the worker and the MSAL silent frame, must be verified in the spike and kept as tight as it can be. Make a CSP violation a failing end-to-end test, not a console warning.

### API and database hardening

- Functions app: HTTPS only, minimum TLS 1.2, FTP deployment disabled, CORS limited to the web origins.
- Azure SQL: Entra-only authentication (SQL logins disabled), connections encrypted, the API's managed identity granted only the permissions it needs on the `stride` schema. Deployment migrations run under a separate identity.
- Azure SQL firewall: the Consumption plan has no fixed outbound addresses, so the MVP allows Azure services. Record this as a known and accepted risk, and plan network restriction when the plan or tier changes.
- Encryption at rest and automated backups are provided by Azure SQL. State in the privacy notice that deleted data can persist in backups until the backup retention period ends.

### Privacy by design checklist

- No athlete names or birth years in URLs, logs, error messages or telemetry. Use opaque identifiers.
- No analytics cookies, no advertising or social scripts, no session replay.
- Defaults are the safe options: video stays on the phone, cloud clip storage is off, share links expire, report names show first name and initial.
- Every stored item has a deletion path and a retention rule.

### Observability

| Concern | Approach |
| --- | --- |
| API logs and metrics | Application Insights, workspace-based, with a daily ingestion cap set low (for example 0.1 GB) so that logging can never become the cost problem |
| Web errors | Application Insights browser SDK for unhandled errors and failed API calls only. No page view tracking, no user identifiers |
| Operational events | `analysis_completed` with mode, gate status, duration, frame count, frame rate and phone family. `analysis_failed` with the failure code. `device_check` with the result. No personal data |
| Scrubbing | A telemetry initialiser removes query strings, bodies and any property named like a person field |
| Alerts | Function failure count, 5xx rate, free database compute remaining below 20 percent, the subscription budget alert, and a free external uptime check on `/v1/health` |

The operational events double as the evidence for the tested phone list, because they show which phones pass the gate in practice.

### Failure codes

Use one enum in `packages/shared`, mapped to coach-facing messages in `strings.ts`: `decode_failed`, `unsupported_codec`, `model_load_failed`, `no_person`, `tracking_lost`, `timing_invalid`, `out_of_memory`, `cancelled`, `unknown`. Wrap the React tree in an error boundary that offers Reload and "Copy a support code" without exposing details.

### Security checks before the pilot

- Run an OWASP ZAP baseline scan against the dev environment in CI.
- Manually try to bypass organisation scoping with a second test organisation, including direct SQL through the API identity.
- Review the privacy notice, consent template and data processing terms with a POPIA practitioner.

## Infrastructure, environments and CI/CD

Infrastructure lives in the `statedge-infra` repository from the Azure migration plan, as a new module `stride` with two environments. Resource names follow `<type>-stride-<env>-san`, where `san` is South Africa North.

### Environments

| Environment | Branch | Purpose |
| --- | --- | --- |
| `local` | any | Vite dev server, Azure Functions Core Tools, Azurite, SQL Server in Docker running the same migrations |
| `dev` | `dev` | Shared test environment, own resource group, own free database, own Entra app registrations |
| `prod` | `main` | Live, deployed only after manual approval |

Both cloud environments sit in the company subscription. Each has its own Azure SQL free-offer database, because the free allowance applies per database and a subscription can hold several.

### Terraform resources per environment

| Resource | Notes |
| --- | --- |
| Resource group | South Africa North, tagged with environment and owner |
| Static Web App | Free plan. Created in West Europe because the service is not offered in South Africa North. It serves only static files |
| Storage account | Standard LRS, South Africa North, required by Functions |
| Function App | Linux, Node 20 or later, Consumption plan, system-assigned managed identity, HTTPS only, TLS 1.2 minimum, FTP disabled, CORS set to the web origin. Check that the plan is offered in the region when provisioning |
| SQL server and database | South Africa North, Entra-only authentication, serverless General Purpose with the free-offer settings (minimum 0.5 vCore, auto-pause). Use the provider's free-offer arguments if present, otherwise create the database with the Azure CLI free-limit option and import it into state. Firewall rule that allows Azure services |
| Log Analytics workspace and Application Insights | Workspace-based, 30-day retention, daily cap 0.1 GB |
| Budget and alerts | A US$15 resource-group budget with notifications at 50, 80 and 100 percent, in addition to the subscription budget. Action group that emails the founder. Metric alerts as listed in the security section |
| Federated identity for GitHub | User-assigned identity with credentials for the repository's `dev` and `prod` environments |
| Role assignments | Least privilege: the pipeline identity may deploy to the function app and read the static web app deployment token, nothing more |
| GitHub environment secret | The static web app deployment token, written by the Terraform GitHub provider. This is the one secret that the platform requires |

Database permissions, set once by a migration script run under the migrator identity:

```sql
CREATE USER [func-stride-prod-san] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [func-stride-prod-san];
ALTER ROLE db_datawriter ADD MEMBER [func-stride-prod-san];
GRANT EXECUTE ON SCHEMA::stride TO [func-stride-prod-san];
-- Never add the API identity to db_owner or grant ALTER ANY SECURITY POLICY.
-- Members of db_owner can switch row-level security off.
```

### Manual steps, documented in the repository

1. Create the external tenant and app registrations (see the auth section).
2. At GoDaddy, add the CNAME for the web hostname (for example `stride.statedge.co.za`) pointing at the static web app. As in the migration plan, the custom domain resource fails on the first apply until DNS exists, so apply in two phases.
3. Use the default `azurewebsites.net` hostname for the API in the MVP. Check whether managed certificates are available for a custom API hostname on the chosen plan before adding one.
4. Create the first organisation with `scripts/create-org.ts`.

### Local development

- `pnpm dev` starts Vite, the Functions host and Azurite. `docker compose up` provides SQL Server for local runs, and `pnpm db:migrate` applies the migrations.
- Set `DEV_FAKE_AUTH=true` to sign in as a seeded test coach without Entra. This switch is honoured only when `ENVIRONMENT=local`. A test asserts that the API rejects fake auth in every other environment, and the deploy workflows fail if the variable is present.
- `pnpm seed` creates two test organisations, athletes, consents and a few analyses built from the keypoint fixtures, so that the cross-organisation tests have data.

### GitHub Actions

Use the same gate pattern as Tournament Manager: lint, unit tests, build, end-to-end smoke tests, then deploy exactly the artefact that passed.

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `ci.yml` | Pull request and push | Install with `--frozen-lockfile`, lint, typecheck, unit tests, licence check, audit, build web and API, Playwright smoke tests against the built web app with a stubbed API, upload artefacts |
| `deploy-dev.yml` | Push to `dev` | Log in with OIDC, run migrations on the dev database, deploy the API, deploy the web app, call `/v1/health` |
| `deploy-prod.yml` | Push to `main` | Same as dev but behind the `prod` environment, which requires a manual approval |

Pin every third-party action by commit hash. Give workflows `permissions: { id-token: write, contents: read }` and nothing more. Migrations run before the new API is deployed, so every migration must be backwards compatible with the previous API version (add columns before using them, never rename in one step).

### Cost guardrails

| Item | Expected | Tripwire |
| --- | --- | --- |
| Static Web Apps (Free) | US$0 | Move to Standard only for a contract that needs an SLA |
| Functions (Consumption) and its storage account | Within free grant, a few cents of storage | Alert on execution count approaching the grant |
| Azure SQL free offer | US$0 | Alert when remaining free vCore seconds drop below 20 percent, then choose pause or paid serverless |
| Entra External ID | US$0 below 50,000 monthly active users | Check the first invoice for add-on charges |
| Application Insights and Log Analytics | Held by the daily cap | Alert on cap reached |
| Resource-group budget | US$15 | Notification at 50, 80 and 100 percent |

The upgrade path for the database, in order of cost: continue the free serverless database with billing beyond the free amount, then move the schema to the migrated Postgres in South Africa North once that exists, then to a paid Postgres Flexible Server. Keep SQL access behind a thin repository layer so that a move is a re-point and a dialect translation, not a rewrite. Do not introduce any other paid service without approval.

## Testing and acceptance criteria

The riskiest code (analysis) is pure, so most of the testing effort goes where bugs are cheapest to find. Tests are written with each feature and run in CI on every pull request.

### Test layers

| Layer | Tool | What it covers |
| --- | --- | --- |
| Analysis unit tests | Vitest | Filters, gap filling, orientation, event detection, metrics, confidence, gate, calibration, keypoint file round trip |
| Synthetic gait tests | Vitest | A generator produces known cadence, contact time, overstride, trunk lean and knee angle, with chosen noise and dropped landmarks. Tests assert recovery within tolerance, and that confidence falls as data worsens |
| Fixture tests | Vitest | Recorded keypoint files from the spike: good sprint, good distance, occluded far leg, camera moved, wrong frame rate, athlete stops. Each has an expected gate result and expected metric ranges |
| API tests | Vitest with SQL Server in Docker | Row-level security across two organisations, consent rules for minors, idempotency, error codes, size limits, invite and seat rules, share links, retention sweep |
| Contract tests | Vitest | Shared zod schemas round-trip. The generated OpenAPI document is compared with the committed one |
| Component tests | Testing Library | Calibration tap logic, metric cards and badges, gate banner, consent form, outbox pill |
| End-to-end | Playwright (Chromium and a mobile viewport) | Full flows with fake auth, a tiny clip and a fixture pose estimator injected in test builds only |
| Real-model check | Playwright, nightly | One short real clip through the real MediaPipe model on the CPU delegate, to catch dependency regressions |
| Accessibility | `axe-core` inside Playwright | Home, athletes, import, result viewer, report builder |
| Device checks | Manual checklist before each release | S23 Ultra and an iPhone: installed PWA, offline loop, a 5-second 240 fps clip, wake lock, storage |

Fixtures contain keypoints only, never video of identifiable people. Record in a README where each came from and that its owner agreed to its use.

### Budgets

Starting values, adjustable after the spike:

- Initial JavaScript for the first route: at most 250 KB gzipped, excluding lazy routes and models.
- Public report page: loads without the analysis code and renders on a mid-range phone on 4G in under 3 seconds.
- No test may depend on the network or on Entra. Cloud services are stubbed.

### Acceptance criteria by feature

| Feature | The feature is done when |
| --- | --- |
| Sign-in and invite | A new coach follows an invite link, signs in with email, lands in the right organisation with the right role. A used, expired or mismatched invite is refused. A full organisation refuses a new invite |
| Athletes and consent | A coach adds an athlete, records a guardian consent for a minor, and sees the correct badge. Analysis cannot start for an athlete without consent. Withdrawing blocks future saves. An admin can delete an athlete and everything linked to them |
| Device check | A clip from the S23 Ultra shows true frame rate, resolution, codec and timing regularity, and a pass, conditional or fail result with a reason. The result is recorded |
| Import and calibrate | A coach imports a calibration clip and run clips, taps two markers, confirms the distance, draws an athlete box, and sees the scale and any warnings |
| Analysis job | A 5-second 240 fps clip completes with visible progress, can be cancelled, keeps memory flat, and never blocks the UI thread for more than 50 ms |
| Quality gate | Each check in the gate table has a test for pass, warn and fail. A failed clip shows reasons and tips and cannot be saved. A conditional result hides exactly the metrics its warnings list |
| Result viewer | The skeleton follows the athlete frame by frame at all playback speeds. Event markers jump to the right frame. Every metric shows value, unit, side, confidence and a reason when the label is lowered |
| Save and offline | With the network off, a coach can import, analyse, review and queue a save. When the network returns the outbox flushes in order with no duplicates. Failed entries show a reason and can be retried or discarded |
| Compare | Two analyses of one athlete play in sync on the first initial contact. The metric table shows change and warns when mode or calibration differ |
| Report and share | The PDF contains the disclaimer, key frames, metrics with confidence, and selected notes, and no hidden metric values. A share link opens without sign-in, shows only first name and initial, can be revoked, and then shows the unavailable page |
| Retention and deletion | The daily sweep removes expired shares, invites and old audit rows and writes one audit entry. Local clips older than the retention period are removed on app start |
| Organisation boundary | A test user in organisation B cannot read, write or list anything of organisation A by any route, and a query with no organisation context returns no rows |
| Offline readiness | After "Prepare for offline", the app opens in airplane mode, shows the capture guide, and runs an analysis |

## Build plan for Claude Code

Build in milestones. Each milestone ends at a gate, where work stops for review before the next begins. The first milestone is a spike that answers the technical questions this spec could only estimate. Its measured numbers replace the starting values in the configuration.

### Milestones

| Milestone | Weeks | Scope | Gate |
| --- | --- | --- | --- |
| M0 Spike | 1 to 2 | Repository scaffold, analysis package skeleton, spike page that decodes a real S23 Ultra clip and runs pose on it, keypoint fixtures | Measured decode, pose speed and event stability are good enough to continue, with the configuration updated from the results |
| M1 Foundation | 3 | Infrastructure for dev, database migration 001 with security policy, API skeleton with auth, web shell with sign-in, PWA, CI and deploy to dev | A coach signs in on a phone against dev. Row-level security tests pass |
| M2 Athletes and consent | 3 to 4 | Athletes, consent, invites, organisation settings, outbox basics | Acceptance criteria for sign-in, invite, athletes and consent met |
| M3 Capture to result | 4 to 5 | Device check, import, calibration, athlete box, analysis job, quality gate, result viewer, local clip library | The full offline loop works on the S23 Ultra |
| M4 Save, history, compare | 5 to 6 | Save results and keypoints, full outbox, athlete history and trends, comparison | Save and offline, and compare criteria met |
| M5 Reports and sharing | 6 | Key frames, PDF, share links, public viewer | Report and share criteria met |
| M6 Hardening and pilot | 7 to 8 | Retention sweep, audit log, observability, security checks, accessibility, iOS pass, runbook, production deploy | Pilot-ready, with the pre-pilot security checks done |
| Stretch | After M6 | Clip upload to Blob, resumable jobs, Afrikaans, organisation logo, email invites | Decided after the pilot |

### M0 tasks (build these first)

1. **Scaffold.** Create the monorepo with pnpm workspaces, TypeScript strict mode, ESLint, Prettier, Vitest, and a CI workflow that lints, typechecks and tests. `apps/web` renders a blank page. Done when CI is green on an empty change.
2. **Analysis package skeleton.** Create `packages/analysis` with `types.ts`, `config.ts` (every starting value in this spec, commented), and stubs for each module. Write the synthetic gait generator and tests for the Butterworth filter, Hampel filter and gap filling. Done when those tests pass.
3. **Clip inspector.** A dev page at `/dev/spike` that picks a file and shows codec, resolution, frame count, and a plot of frame timestamp intervals using `mp4box.js`. Done when it reports the real frame rate and jitter of an S23 Ultra Slow motion clip and of an iPhone clip.
4. **Decode.** Implement the WebCodecs decoder and the video-element fallback behind one interface. Done when both decode a 5-second clip to frames with correct timestamps, and the page reports frames per second of decoding.
5. **Pose.** Implement `PoseEstimator`, the MediaPipe implementation, and ROI cropping. Run it in a worker. Done when the page shows the skeleton over the clip, and records pose time per frame on GPU and CPU delegates, with both a module worker and a classic (IIFE) worker tried.
6. **Events and metrics on real data.** Export the raw landmarks to the SKP1 format, load them into the pure package, and run the events and the first metrics (`cadence`, `contact_time`, `overstride`, `trunk_lean`). Done when a plot shows detected contacts and toe-offs over the foot height and speed traces.
7. **Fixtures.** Save keypoints for at least ten clips: sprint and distance, near leg on each side (athlete running in both directions), plus deliberately bad clips (camera moved, wrong mode, athlete stops, part of the body out of frame). Add expected gate results.
8. **Spike report.** Write `docs/spike-report.md` with the measured numbers, the decisions taken (decoder, worker type, delegate, model size), and the updated config values. Open questions go at the end.

M0 gate checks, measured and recorded: real frame timing of S23 Ultra files; whether WebCodecs decodes them or the fallback is needed; milliseconds per frame for pose on the phone; total time for a 5-second 240 fps clip; whether events are stable across repeated passes by the same athlete; whether foot landmarks are good enough at the achieved athlete size.

### M1 tasks

1. Terraform module `stride` and the `dev` environment, including the budget alert, in `statedge-infra`.
2. Migration `001` from the data model section, the migration runner, the security policy, and the connection helper `withOrg`. Tests: no context returns no rows, cross-organisation reads and writes are blocked.
3. API skeleton: health, `me`, auth middleware with real token validation and the local fake mode, error format, logging, CORS, shared zod schemas.
4. Web shell: routing, auth guard, MSAL sign-in, design tokens, `AppShell`, `BottomNav`, `OutboxPill`, PWA manifest and service worker, capability check.
5. `deploy-dev.yml` including migrations and a health check.
6. `scripts/create-org.ts` and `scripts/seed.ts`.

### M2 to M6 task outlines

Create detailed tasks at the start of each milestone from the matching sections of this spec, each with the acceptance criteria from the testing section. Keep tasks small enough to review in one sitting: one route group, one screen, or one analysis module at a time.

### Working agreement

- Start each milestone in plan mode. Present the plan and list any questions before changing code.
- Write tests with each feature. A task is not done without them.
- Put every tunable value in `config.ts` with a comment. Never scatter numbers through the code.
- Do not add dependencies, services or features that this spec does not name without asking.
- Keep commits small and messages clear. Open a pull request per task or milestone slice.
- At a gate, stop and summarise what was built, what was measured, what differs from the spec, and what is next.
- When the spec and reality disagree, say so and propose a default. Do not guess silently.

### Starter CLAUDE.md for the new repository

```markdown
# StatEdge Stride

Web app for coaches to analyse running technique from phone slow-motion video.
Analysis runs on the phone. See docs/spec.md (this specification) for detail.

## Stack
React 18 + TypeScript + Vite PWA, Azure Functions (Node, TypeScript), Azure SQL,
Entra External ID, MediaPipe Pose Landmarker, pnpm monorepo.

## Layout
apps/web, apps/api, packages/shared (zod schemas), packages/analysis (pure TS).

## Commands
pnpm dev | pnpm test | pnpm lint | pnpm typecheck | pnpm db:migrate | pnpm seed

## Rules
- packages/analysis has no DOM, network or model imports. Keep it pure and tested.
- All tunable values live in packages/analysis/src/config.ts.
- Parse every boundary with zod. No any. No string-built SQL.
- Every query on org data goes through withOrg(). RLS must fail closed.
- Never show a metric without a confidence label. Never show good or bad judgements.
- Video stays on the device by default. No athlete names in URLs, logs or telemetry.
- No secrets in the repo. Managed identity and GitHub OIDC only.
- Only MIT, Apache-2.0, BSD or ISC dependencies. No AGPL or GPL.
- Do not add dependencies or services without asking.
- Work milestone by milestone and stop at each gate.
```

### Open questions

1. **Hostnames.** Is `stride.statedge.co.za` right for the web app? The API uses the default Azure hostname for now.
2. **Sign-in methods.** Email one-time passcode only, or also Google and Microsoft?
3. **Consent wording.** Who writes the consent form and privacy notice, and when can a POPIA practitioner review them?
4. **Language.** Is Afrikaans needed at launch? The code is ready for it, but translation is a task.
5. **Run direction.** Should the capture guide ask for passes in both directions, so that each leg is nearest the camera once? The engine handles either direction, and both directions improve left-right confidence.
6. **Local copies.** Is keeping a copy of each clip inside the app on by default the right trade-off for storage on coaches' phones?
7. **Database route.** Standalone Azure SQL free database now, or wait for the migrated Postgres?
8. **Repository.** This spec assumes a new repository separate from Tournament Manager. Confirm.

### Technical risks and where they are tested

| Risk | Tested in |
| --- | --- |
| Samsung slow-motion files have timestamps that need correcting | M0 clip inspector |
| HEVC clips do not decode with WebCodecs | M0 decode task, fallback decoder |
| MediaPipe does not load in a module worker | M0 pose task |
| Foot landmarks too noisy at the achieved athlete size | M0 events task, gate thresholds |
| Processing too slow or memory-hungry on the phone | M0 measurements, M3 performance acceptance |
| iOS storage eviction and missing background sync | M6 iOS pass |
| Entra External ID setup or billing surprises | M1 sign-in task, first invoice check |
| Free database allowance too small | Alerts from M1, upgrade path in the infrastructure section |
