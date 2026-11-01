# Trying Stride on your computer

A step-by-step guide to running StatEdge Stride locally with a demo profile, so that you can click through every screen. Everything runs on your computer: a local database in Docker, the API and the web app. Sign-in is a "Sign in as" button instead of Entra, and nothing is sent anywhere else.

## What you get

| Who or what         | Details                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coach to sign in as | **coach@school-a.test** (Sipho Coach, Seeded School A). **admin@school-a.test** (Thandi Admin) also sees Settings.                                                                            |
| **Amahle Demo**     | Pre-filled: three saved runs (6, 3 and 1 weeks ago), notes, a report, and an open share link. Shows the history, the trend, the before-and-after view, reports and sharing without any setup. |
| **Pieter Demo**     | Empty, with consent recorded. Use him to go through the app from the start: session, import, calibration, analysis, save, report.                                                             |
| Other seeded people | Lerato Seedling (a minor, guardian consent), Johan Testrun, Naledi Noconsent (no consent: try saving for her), and a second organisation, Seeded Club B, to show that it cannot see School A. |
| Test videos         | `fixtures/clips/synthetic-calibration-240fps.mp4` and `fixtures/clips/synthetic-run-240fps.mp4`: a drawn stick figure on a track, filmed at 240 fps. No real person.                          |

Amahle's latest run is the test video's own result. Her two earlier runs are copies of it with a few measurements moved (cadence, ground contact, foot landing, trunk lean, bounce), so that the trend and the comparison have changes to show. Her results were made on "another phone", so the video is not on yours: the result screen asks you to pick it, and recognises the run test video.

## One-time setup

You need about 10 GB of free disk space.

1. **Docker Desktop.** Install it from docker.com and start it. On Windows, let it turn on WSL 2 when it asks.
2. **Node.js 22.** Install the "22 LTS" version from nodejs.org.
3. **pnpm.** In a terminal (PowerShell on Windows, Terminal on a Mac):

   ```bash
   corepack enable
   ```

4. **Get the code** and install it, in the folder you want it in:

   ```bash
   git clone https://github.com/BosCaleb/statedge_stride.git
   ```

   ```bash
   cd statedge_stride
   ```

   ```bash
   git checkout claude/demo-profile
   ```

   ```bash
   pnpm install
   ```

## Start it

With Docker Desktop running:

```bash
pnpm demo
```

This starts the database, sets it up, loads the seeded people and the demo profile, downloads the pose model (about 10 MB, the first time only) and starts the app. The first run takes a few minutes. When it prints the demo summary and `Local: http://localhost:5173/`, open **http://localhost:5173** in Chrome or Edge.

The summary also prints **the share link of Amahle's report**. It is shown only then (the server stores only a fingerprint of it), so copy it now.

To stop, press Ctrl+C in the terminal. `pnpm demo` again resets everything to the demo state, including anything you changed. To keep your changes between runs, start it with `pnpm dev` instead (Docker Desktop must be running).

## Things to try

### As Amahle's coach (pre-filled)

1. Sign in as **coach@school-a.test**.
2. **Athletes → Amahle Demo.** Her consent, three runs in the history, the cadence trend (change the measurement to see others), and her report with "Link open until …".
3. **Open the newest run.** Pick `synthetic-run-240fps.mp4` when it asks for the original clip: the skeleton is drawn over the video. Step through frames, jump to contacts on the timeline, tap a measurement to see its spread, read the notes.
4. **Compare.** Back on her page, tick two runs and compare: both clips play in step, and the table shows each change in neutral words.
5. **Make a report** from a run or from the comparison: choose frames, tick notes, choose the name style, make the PDF, download it. Then make a share link.
6. **Open the share link** (the printed one, or one you made) in a private window: that is what a parent or physio sees, signed out. Revoke it from the report and reload: "This link is no longer available."

### As Pieter's coach (from the start)

1. **Home → New session.** Distance mode, tick Pieter Demo, create.
2. **Import both test videos** together. Mark `synthetic-calibration-240fps.mp4` as "The calibration clip"; the run is matched to Pieter. Say they were filmed at 240 fps if asked.
3. **Calibrate.** Tap the two orange cones and enter **5 m** between them.
4. **Analyse.** Open Pieter's run, move to a frame where the whole runner is in view, draw a box around him, and press "Analyse this run". It takes from under a minute to a few minutes, depending on your computer.
5. **Save**, add a note, make a report, share it, revoke it.

### Other things worth a look

- **Offline:** in Chrome's developer tools (F12 → Network → Offline), add an athlete or save a result: it waits in the sync pill and sends when you go back online. Share links say they need a connection.
- **Consent rules:** try saving a result for Naledi Noconsent.
- **Another organisation:** sign out and sign in as **admin@club-b.test**: none of School A's athletes are visible.
- **Settings** (as admin@school-a.test): coaches and invites, the clip retention period, and the audit log of everything above.
- **Dark mode:** the account menu at the top right.
- **Device check and capture guide:** from Home and the bottom bar.

## What is not the real thing here

- Sign-in is the local "Sign in as" picker, not Entra External ID.
- The test videos are synthetic, so the measurements are clean and confidence is mostly high. A real phone video of a person gives a better feel for the confidence labels and the quality checks. Film one in slow motion (side-on, the whole body in view, 240 fps if the phone can) and import it like the test video.
- On a computer, the phone-only parts (filming, the share sheet, installing the app) are limited. A deployed test environment is the way to try those on a phone (`docs/azure-deployment.md`).

## If something goes wrong

- **"Cannot connect to the Docker daemon"** or the database does not start: start Docker Desktop and wait until it says it is running, then `pnpm demo` again.
- **Port in use** (5173, 7071 or 1433): close the other program using it, or stop an earlier `pnpm demo` with Ctrl+C.
- **The model download fails:** check the internet connection and run `pnpm fetch-models` on its own.
- **A blank page or old data:** in Chrome, open the page's developer tools → Application → Clear site data, then reload.
