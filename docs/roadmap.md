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
| M5 Reports and sharing    | Not started (API schemas and routes are defined, not implemented)        |
| M6 Hardening and pilot    | Partly built (audit log, alerts, ZAP scan in CI); the rest below         |

## Outstanding for the MVP

### M5 Reports and sharing

- **Report builder (`/reports/:id`).** Choose one analysis, or two of the same athlete and mode for a comparison; pick three to five key frames (the three automatic ones are always there, others need the clip on the phone); pick which notes to include; choose the name style (first name and initial by default, or full name); preview.
- **Key frames for reports.** Render any chosen frame at 1280 px with the skeleton and a caption, JPEG at quality 0.8 and under 300 KB. The three automatic frames already exist from M3.
- **PDF on the phone.** jsPDF and jspdf-autotable, loaded only when needed. A4 portrait: header with wordmark and organisation, athlete block, frame strip, primary and secondary metric tables with confidence and descriptions, the comparison table with caveats, notes, "How to read this", the disclaimer and a footer with the algorithm version and page numbers. Selectable text in Inter and Oswald. Hidden metrics listed once with their reason, never as blanks. Download, or share with the Web Share API.
- **Report snapshot and storage.** `PUT /v1/reports/{id}` and `PUT /v1/reports/{id}/frames/{n}` through the outbox. Results only: no keypoints, birth year or unselected notes.
- **Share links.** `POST /v1/reports/{id}/share` (needs a connection and an active sharing consent), 32-byte token shown once, only its hash stored, default expiry 30 days (maximum 90), revoke at any time. Expired, revoked and unknown links look the same.
- **Public viewer (`/r/:token`).** No sign-in, cookies, analytics or third-party requests; its own small bundle; `noindex`, `no-referrer` and `no-store`. Shows first name and initial, date, frames, primary metrics with confidence, selected notes, expiry and the disclaimer.
- **Tests.** PDF text checks from a fixed snapshot (disclaimer, metric names, confidence labels, footer, no hidden values); no full name, birth year or unselected note in a shared snapshot; create, open signed-out, revoke and see the unavailable page end to end.

### M6 Hardening and pilot

- **Retention sweep.** A daily timer function that removes what has passed its retention period (clip metadata past the organisation's setting, expired share links and their frames), writes a `retention.sweep` audit row, and is tested against SQL Server.
- **Browser telemetry.** The Application Insights browser SDK for unhandled errors and failed API calls only, with the scrubbing initialiser (no query strings, bodies or person fields), and the operational events `analysis_completed`, `analysis_failed` and `device_check`. These events also become the evidence for the tested phone list.
- **Error boundary to telemetry.** The support code is already shown; send the error with it.
- **Security checks before the pilot.** Triage the first OWASP ZAP findings and make the scan gate the dev deploy; try to break organisation scoping with a second test organisation, including direct SQL as the API identity; review the privacy notice, consent template and data processing terms with a POPIA practitioner.
- **Accessibility pass.** Axe checks already run in the browser tests; add a manual screen reader pass (TalkBack and VoiceOver) of the main flow.
- **iOS pass.** Safari on iPhone: decoding, the pose model, storage eviction, the missing background sync, and the capture guide for iPhone slow motion.
- **First deployment.** Run `infra/deploy.sh dev` and prod, fill in the web settings, and confirm the first sign-in, migration, save and share against Azure (see `docs/azure-deployment.md`).
- **Runbook.** Extend `docs/runbook.md` with incident steps: database paused, free allowance used up, a coach locked out, a link to revoke, a data request.

### Gates still open (need the phone or Azure)

1. M0: decode speed, pose time per frame on GPU and CPU, and event stability on real S23 Ultra slow-motion clips, then update `packages/analysis/src/config.ts` from the results.
2. M1: a coach signs in on a phone against the dev environment.
3. M3: the full offline loop on the S23 Ultra.
4. M4: save offline and flush, and the comparison, on the phone.

### Decisions waiting on StatEdge (open questions in the spec)

1. Web hostname (`stride.statedge.co.za`?).
2. Sign-in methods: email one-time passcode only, or also Google and Microsoft.
3. Who writes the consent form and privacy notice, and when the POPIA review happens.
4. Afrikaans at launch, or later.
5. Whether the capture guide asks for passes in both directions.
6. Whether keeping a copy of each clip on the phone stays on by default.
7. Azure SQL free database now, or the migrated Postgres later.
8. Whether the free-database exhaustion behaviour for prod should change from pause to billing once coaches rely on it (see the cost notes in `docs/azure-deployment.md`).

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
- **Better foot contact detection** from the heel and toe landmarks with a learned classifier, once there is labelled data.
- **Model choice per phone:** the lite pose model on slower phones, the full or heavy model on fast ones, picked by the device check.

### Cost, speed and operations

- **Move the Function App to Flex Consumption** before the Linux Consumption plan retires (announced for 2028). It brings managed-identity storage access (no account key) and faster cold starts; only the plan and app resources change.
- **Shorter database auto-pause delay** (the template uses 60 minutes) to stretch the free compute allowance further.
- **Keypoints out of SQL into Blob Storage** if the database approaches the free 32 GB; the SQL row would keep a pointer.
- **Postgres route:** move to the migrated Postgres in South Africa North once it exists, as the spec's upgrade path describes. The repository layer keeps this to a re-point and a dialect translation.
- **Smaller web bundle for older phones:** split the pose runtime and charts further and measure on a budget Android.
- **Automated infrastructure what-if in CI** with a read-only Azure identity, so that template changes show their effect in the pull request.
- **Dependabot or Renovate** for dependency updates, with the audit and licence checks as gates.
