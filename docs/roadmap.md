# Roadmap

What is still to build for the MVP, what is waiting on StatEdge, and features that could add value to Stride or make it cheaper, faster or easier to run after the pilot. The MVP scope and acceptance criteria are in `docs/spec.md`; every place the build differs from it is in `docs/decisions.md`.

## Where the build stands

| Milestone                 | Status                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| M0 Spike                  | Built. On-device measurements on the S23 Ultra still to be made          |
| M1 Foundation             | Built. Not yet deployed: sign-in on a phone against dev is still to test |
| M2 Athletes and consent   | Built and tested                                                         |
| M3 Capture to result      | Built and tested in the browser. The offline loop on the S23 is to test  |
| M4 Save, history, compare | Built and tested. Gate met in automated tests                            |
| M5 Reports and sharing    | Built and tested. PDF and share link on a real phone still to try        |
| M6 Hardening and pilot    | Partly built (sweep, telemetry, scoping tests, runbook); the rest below  |

## Outstanding for the MVP

### M5 Reports and sharing

Built: the report builder, the PDF made on the phone, the report saved with the athlete, share links, the public report page and the athlete's report list (see `docs/decisions.md`, D95 to D103). Still to do on a real phone: make a PDF on the S23 Ultra and an iPhone, send it with the share sheet, and open a link on a parent's phone over 4G against the 3-second budget.

### M6 Hardening and pilot

Built (see `docs/decisions.md`, D111 to D115):

- **Retention sweep.** `retention-sweep` runs daily at 00:00 UTC, per organisation inside `withOrg`: expired and revoked share links with their frames, expired invites, and audit rows older than 24 months, with one `retention.sweep` audit row of counts. Tested against SQL Server. Uploaded clips are not swept because uploads (stretch) do not exist yet.
- **Browser telemetry.** The Application Insights SDK for unhandled errors and failed API calls only (by route name), with the scrubbing initialiser, and the events `analysis_completed`, `analysis_failed` and `device_check`. Off in builds without a connection string. These events also become the evidence for the tested phone list.
- **Error boundary to telemetry.** Both error screens send the error with the support code the coach can copy.
- **Organisation scoping.** A second test organisation, every table checked in direct SQL as the API identity and every id-taking route called across the boundary; nothing leaked.
- **Runbook.** Incident steps in `docs/runbook.md` for a paused database, the free allowance used up, a coach locked out, a link to revoke and a data request, with two staff scripts (`pnpm invite-admin`, `pnpm revoke-link`).

Still to do:

- **Security checks before the pilot.** Triage the first OWASP ZAP findings and make the scan gate the dev deploy; review the privacy notice, consent template and data processing terms with a POPIA practitioner.
- **Accessibility pass.** Axe checks already run in the browser tests; add a manual screen reader pass (TalkBack and VoiceOver) of the main flow.
- **iOS pass.** Safari on iPhone: decoding, the pose model, storage eviction, the missing background sync, and the capture guide for iPhone slow motion.
- **First deployment.** Run `infra/deploy.sh dev` and prod, fill in the web settings, and confirm the first sign-in, migration, save and share against Azure (see `docs/azure-deployment.md`). Then check that the first night's sweep ran and that browser telemetry arrives scrubbed (`docs/runbook.md`, Monitoring).

### Gates still open (need the phone or Azure)

1. M0: decode speed, pose time per frame on GPU and CPU, and event stability on real S23 Ultra slow-motion clips, then update `packages/analysis/src/config.ts` from the results.
2. M1: a coach signs in on a phone against the dev environment.
3. M3: the full offline loop on the S23 Ultra.
4. M4: save offline and flush, and the comparison, on the phone.
5. M5: a PDF made and sent from the phone, and a share link opened on another phone over 4G.

### Decisions waiting on StatEdge (open questions in the spec)

1. Web hostname (`stride.statedge.co.za`?).
2. Sign-in methods: email one-time passcode only, or also Google and Microsoft.
3. Who writes the consent form and privacy notice, and when the POPIA review happens.
4. Afrikaans at launch, or later.
5. Whether the capture guide asks for passes in both directions.
6. Whether keeping a copy of each clip on the phone stays on by default.
7. Azure SQL free database now, or the migrated Postgres later.
8. Whether the free-database exhaustion behaviour for prod should change from pause to billing once coaches rely on it (see the cost notes in `docs/azure-deployment.md`).

## AI assistance

Stride already runs AI where it matters most: MediaPipe's pose model finds 33 body points in every frame, on the phone. The steps after it (filters, foot contacts, measurements, confidence and the quality gate) are deliberate rules: every number can be explained and the confidence rules can say why, with no training data needed. More AI is added where it removes work or fixes a known weakness, in this order.

### Before the pilot (built)

- **Runner detection.** On the analyse screen, MediaPipe's object detector (EfficientDet-Lite0, int8, 4.6 MB, Apache-2.0) looks for people in a dozen frames of the clip. Stride proposes a box around the runner, at the earliest frame where they are nearly as large as they get, ignoring people who stand still. The coach confirms or draws another; with nobody found, drawing by hand works as before. See D107.
- **Heavy pose model on fast phones.** The device check times the heavy pose model on the coach's own test clip. A phone that runs it within 55 ms a frame (a 5 s, 240 fps clip within the spec's 90 s) uses it for analysis; others keep the full model, and an analysis falls back to the full model when the heavy one cannot load. See D108.

### During the pilot

- **Contact correction in the result viewer.** Let the coach nudge a detected foot contact or toe-off to the right frame. The coach's result improves at once, and every correction becomes a labelled example (stored with consent) for the learned detector below.
- **Measure on real phones.** Tune `heavyMaxMsPerFrame` and the runner detection values from the pilot phones' device checks and clips.

### After the pilot

- **Learned foot-contact detector.** A small model (well under 1 MB, ONNX Runtime Web or TensorFlow.js) that reads the body points over time and marks contacts and toe-offs, trained on the corrections above. It targets the weakness seen on real clips: missed or doubled landings when the athlete is small or the far leg is hidden. Ships as a new algorithm version only when the fixtures show it beats the rules.
- **Automatic calibration** from cones or track markings found by an object detector, instead of two taps.
- **AI summary of a report** (only if StatEdge wants it): a server-side language model given the measurements only, never video; off by default, describing and never judging (Stride has no validated norms), and reviewed by the coach before anyone else sees it. Needs consent and the POPIA review. Language models small enough for the browser (around 2 GB) are too heavy for the phones Stride targets.

## After the MVP

The spec's stretch list comes first; the rest is grouped by the value it adds. None of these is built or approved, and each new dependency or service needs StatEdge's approval.

### Stretch items named in the spec

- **Clip upload to Blob Storage** (opt-in, needs the `clip_storage` consent), so that a saved analysis can be replayed on any phone and survives a lost phone. Includes the clip deletion the delete-athlete procedure already expects.
- **Resumable analysis jobs:** checkpoint landmarks every 100 frames and offer "Resume analysis" after the phone suspends the tab.
- **Afrikaans:** every string already goes through `strings.ts`; this is translation and a language switch.
- **Organisation logo** on the app header and in reports.
- **Email invites** instead of sharing the link by hand.

### For coaches and athletes

- **Squad view:** one metric across a group on a date, for training groups and school teams.
- **Session plans and reminders:** what to film next time, and a nudge when an athlete has not been analysed for a while.
- **Coach annotations on frames:** lines and angles drawn on a key frame, carried into the report.
- **Athlete or parent read-only access** to their own reports, instead of one link at a time.
- **Front or rear view (2D) for frontal-plane checks** such as crossover and pelvic drop. This is a new analysis with its own validation, not a tweak.
- **Normative bands**, only once StatEdge has validated data for the age groups it serves. The MVP deliberately shows no good or bad judgements.
- **WhatsApp sharing of the report link**, since that is how most links are sent in practice.

### For StatEdge as a business

- **Self-service sign-up and billing** for organisations, with seat limits enforced by plan.
- **Usage dashboard for StatEdge:** organisations, coaches, analyses per month and the gate pass rate, from the operational events (no personal data).
- **Tested phone list from real data:** grow the device profiles from `device_check` results across all organisations.
- **Data export for research,** anonymised and with consent, if StatEdge wants to build its own norms.

### Accuracy and analysis

- **Calibrate the configuration on recorded clips:** grow the fixture set (ten clips minimum in the spec) and re-tune the gate and filters with each algorithm version.
- **Automatic calibration** from known track markings or a printed marker, instead of two taps.
- **Lite pose model on the slowest phones:** the heavy-or-full choice is built (see AI assistance); a third step down to the lite model would help budget phones that are slow even with the full one.

### Cost, speed and operations

- **Move the Function App to Flex Consumption** before the Linux Consumption plan retires (announced for 2028). It brings managed-identity storage access (no account key) and faster cold starts; only the plan and app resources change.
- **Shorter database auto-pause delay** (the template uses 60 minutes) to stretch the free compute allowance further.
- **Keypoints out of SQL into Blob Storage** if the database approaches the free 32 GB; the SQL row would keep a pointer.
- **Postgres route:** move to the migrated Postgres in South Africa North once it exists, as the spec's upgrade path describes. The repository layer keeps this to a re-point and a dialect translation.
- **Smaller web bundle for older phones:** split the pose runtime and charts further and measure on a budget Android.
- **Automated infrastructure what-if in CI** with a read-only Azure identity, so that template changes show their effect in the pull request.
- **Dependabot or Renovate** for dependency updates, with the audit and licence checks as gates.
