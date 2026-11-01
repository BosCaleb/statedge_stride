# Trying Stride on your computer

A step-by-step guide to running StatEdge Stride locally with a demo profile, so that you can click through every screen. Everything runs on your computer, in Docker: a local database, the API and the web app. Sign-in is a "Sign in as" button instead of Entra, and nothing is sent anywhere else.

## What you get

| Who or what         | Details                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coach to sign in as | **coach@school-a.test** (Sipho Coach, Seeded School A). **admin@school-a.test** (Thandi Admin) also sees Settings.                                                                                                                          |
| **Amahle Demo**     | Pre-filled: three saved runs (6, 3 and 1 weeks ago), notes, a report, and an open share link. Shows the history, the trend, the before-and-after view, reports and sharing without any setup.                                               |
| **Pieter Demo**     | Empty, with consent recorded. Use him to go through the app from the start: session, import, calibration and analysis. With the synthetic test video the analysis stops at the quality checks; a real clip gets through to save and report. |
| Other seeded people | Lerato Seedling (a minor, guardian consent), Johan Testrun, Naledi Noconsent (no consent: try saving for her), and a second organisation, Seeded Club B, to show that it cannot see School A.                                               |
| Test videos         | `fixtures/clips/synthetic-calibration-240fps.mp4` and `fixtures/clips/synthetic-run-240fps.mp4`: a drawn stick figure on a track, filmed at 240 fps. No real person.                                                                        |

Amahle's latest run is the test video's own result. Her two earlier runs are copies of it with a few measurements moved (cadence, ground contact, foot landing, trunk lean, bounce), so that the trend and the comparison have changes to show. Her results were made on "another phone", so the video is not on yours: the result screen asks you to pick it, and recognises the run test video.

## Start it in Docker (recommended)

Everything runs in containers: the database, the API and the web app, with the pose model inside the image. All you need on your computer is **Docker Desktop** (from docker.com; on Windows, let it turn on WSL 2 when it asks) and **Git**, and about 10 GB of free disk space.

1. Get the code, in the folder you want it in:

   ```bash
   git clone https://github.com/BosCaleb/statedge_stride.git
   ```

   ```bash
   cd statedge_stride
   ```

   ```bash
   git checkout dev
   ```

2. With Docker Desktop running, build and start it:

   ```bash
   docker compose --profile demo up --build
   ```

   The first build downloads Node, the packages and the pose model and takes a few minutes; later starts take seconds. When the log shows the demo summary and `Local: http://localhost:5173/`, open **http://localhost:8080** (the container's 5173 is published on your computer's 8080).

3. The summary also prints **the share link of Amahle's report**, starting `http://localhost:8080/r/`. It is shown only then (the server stores only a fingerprint of it), so copy it now.

To stop, press Ctrl+C, then remove the containers:

```bash
docker compose --profile demo down
```

**Every start resets the demo data**, so you always begin from the same state. To keep what you change between starts, create a file called `.env` next to `docker-compose.yml` with this line:

```
STRIDE_KEEP_DATA=true
```

**Other ports.** The app uses port 8080 and its API port 8081 on your computer. If either is taken, add other ports to `.env` (the API and the share links follow them), then start again:

```
STRIDE_WEB_PORT=8090
STRIDE_API_PORT=8091
```

**To pick up new changes** later:

```bash
git pull origin dev
```

```bash
docker compose --profile demo up --build
```

`--build` rebuilds the app image with the new code; the database container is kept and updated by the migrations.

## Or run it without the app container

If Node.js 22 and pnpm are installed on your computer (`corepack enable` sets up pnpm), the app can also run directly on it, with only the database in Docker:

```bash
pnpm install
```

```bash
pnpm demo
```

This uses ports 5173 (web), 7071 (API) and 1433 (database), and prints a share link on `http://localhost:5173`. Ctrl+C stops it; `pnpm dev` starts it again without resetting the data.

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
4. **Analyse.** Open Pieter's run, let Stride look for the runner (it moves to a good frame and draws a box when it finds one; on the drawn stick figure it usually does not), or move to a frame where the whole runner is in view and draw a box around him, then press "Analyse this run". It takes from under a minute to a few minutes, depending on your computer.
5. **Expect the quality checks to fail on this video.** The real pose model does not reliably see the drawn stick figure as a person, so the analysis ends with "This clip did not pass the quality checks", each reason measured, and a tip to fix the shoot. That is the screen a coach sees after a poor shoot, and nothing can be saved from it.
6. **For a result you can save, use a real slow-motion clip** of someone who agrees to it: film yourself or a colleague side-on, the whole body in view, at 240 fps if the phone can (120 fps works for distance mode), with two cones a known distance apart in a short calibration clip first. Import it for Pieter as above, then **save**, add a note, make a report, share it and revoke it. Keep such clips out of the repository.

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

- **"Cannot connect to the Docker daemon"** or nothing starts: start Docker Desktop and wait until it says it is running, then start again.
- **"Port is already allocated"** or **"port is already in use"**: another program, or Windows itself, holds that port. Choose other ports in `.env` (see above). For the database's port 1433, stop the other SQL Server, or the earlier containers with `docker compose --profile demo down`.
- **The build fails while downloading:** check the internet connection and run the same command again; Docker resumes where it stopped.
- **A blank page or old screens:** the app keeps a copy of itself in the browser. Reload, or open the page's developer tools → Application → Clear site data, then reload.
- **Start completely afresh**, database included (this deletes everything in it):

  ```bash
  docker compose --profile demo down -v
  ```
