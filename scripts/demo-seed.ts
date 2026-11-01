// pnpm demo:seed: adds two demo athletes to Seeded School A in the local database, for trying the
// app by hand (docs/demo.md). Runs after `pnpm seed`, and replaces the demo athletes when run again.
// Local only.
//
// - Amahle Demo has three saved runs on different dates, notes, a report and an open share link.
//   Each run uses the keypoints of the synthetic test video (fixtures/clips/synthetic-run-240fps.mp4),
//   so picking that video shows the skeleton over it. The two earlier runs are copies of the latest
//   with a few measurements moved, so that history, trends and the comparison have changes to show.
// - Pieter Demo has consent and nothing else, for going through the app from the start.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { defaultAnalysisConfig } from '@stride/analysis/config';
import { clipChecks } from '@stride/analysis/gate';
import { analyse } from '@stride/analysis/pipeline';
import { decodeSkp1 } from '@stride/analysis/skp1';
import { chooseTimebase, timingStats } from '@stride/analysis/timebase';
import type { PoseFrame } from '@stride/analysis/types';
import type { AnalysisResult, MetricResult } from '@stride/shared/analysisResult';
import { DEV_IDENTITIES, DEV_ORGS } from '@stride/shared/devIdentities';
import type { MetricId } from '@stride/shared/enums';
import {
  REPORT_SNAPSHOT_VERSION,
  reportSnapshotSchema,
  shortDisplayName,
  type ReportSnapshot,
} from '@stride/shared/reportSnapshot';
import sql from 'mssql';
import { createDatabase, type Db } from '../apps/api/src/lib/db';
import { newToken } from '../apps/api/src/lib/tokens';
import { scriptDbSettings } from '../apps/api/src/migrate';
import { insertAnalysis, setKeypoints } from '../apps/api/src/repo/analysisStore';
import { audit } from '../apps/api/src/repo/audit';
import { upsertNote } from '../apps/api/src/repo/notes';
import { insertShare, putFrame, upsertReport } from '../apps/api/src/repo/reports';
import { strings } from '../apps/web/src/lib/strings';

const settings = scriptDbSettings();
if (!settings.local) throw new Error('pnpm demo:seed runs against the local database only');

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const WEB_ORIGIN = 'http://localhost:5173';
const ORG = DEV_ORGS.a;
const COACH = DEV_IDENTITIES.find((p) => p.coach?.org === 'a' && p.coach.role === 'coach');
if (!COACH?.coach) throw new Error('no seeded coach in Seeded School A');
const COACH_ID = COACH.coach.id;

const AMAHLE = {
  id: 'd1000000-0000-4000-8000-000000000001',
  first: 'Amahle',
  last: 'Demo',
  year: 2003,
};
const PIETER = {
  id: 'd1000000-0000-4000-8000-000000000002',
  first: 'Pieter',
  last: 'Demo',
  year: 2001,
};

/** The synthetic calibration clip's cones, 5 m apart (scripts/generate-test-clips.ts). */
const CALIBRATION = { ax: 585, ay: 918, bx: 1335, by: 918, distanceM: 5, pxPerM: 150 };

/** Days before today, and the measurements moved for the earlier runs. */
const RUNS: { daysAgo: number; shift: Partial<Record<MetricId, number>>; notes: string[] }[] = [
  {
    daysAgo: 42,
    shift: {
      cadence: -9,
      contact_time: 18,
      overstride: 3.2,
      trunk_lean: 1.6,
      vertical_oscillation: 1.3,
    },
    notes: ['First filmed session. Long ground contact; landing well ahead of the hips.'],
  },
  {
    daysAgo: 21,
    shift: {
      cadence: -4,
      contact_time: 9,
      overstride: 1.5,
      trunk_lean: 0.8,
      vertical_oscillation: 0.6,
    },
    notes: [],
  },
  {
    daysAgo: 7,
    shift: {},
    notes: ['Cadence drills are showing.', 'Keep working on a quicker, lighter landing.'],
  },
];

const day = (daysAgo: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

/** SHA-256 of the first MiB and the size, as the web app fingerprints a clip (D55). */
function fingerprint(bytes: Buffer): string {
  const head = bytes.subarray(0, 1024 * 1024);
  const size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(bytes.byteLength));
  return createHash('sha256').update(head).update(size).digest('hex');
}

/** The latest run: the test video's keypoints through the pure pipeline. */
function analyseTestRun(keypointsGz: Buffer, createdAt: string): AnalysisResult {
  const decoded = decodeSkp1(new Uint8Array(gunzipSync(keypointsGz)));
  if (!decoded.ok) throw new Error(`test run keypoints: ${decoded.reason}`);
  const { header, timesSec, frames: landmarks } = decoded.value;
  const config = defaultAnalysisConfig();
  const mode = 'distance';
  const declaredFps = 240;
  const frameStep = config.metrics.frameStep[mode];
  const timebase = chooseTimebase(timesSec, declaredFps, config);
  const timing = timingStats(timesSec, config.gate.timing.intervalTolerance);
  const durationSec = (timesSec[timesSec.length - 1] ?? 0) - (timesSec[0] ?? 0);
  const frames: PoseFrame[] = landmarks.map((l, index) => ({
    index,
    tSec: timesSec[index] ?? 0,
    landmarks: l,
  }));
  return analyse({
    frames,
    clip: {
      widthPx: header.widthPx,
      heightPx: header.heightPx,
      frameCount: header.frameCount,
      declaredFps,
      codec: 'avc1',
      durationSec,
    },
    timesSec: timebase.ok ? timebase.value.timesSec : timesSec,
    timebase: timebase.ok ? timebase.value.source : 'declared',
    captureFps: timebase.ok ? timebase.value.fps : declaredFps,
    frameStep,
    mode,
    calibration: {
      markerA: { x: CALIBRATION.ax, y: CALIBRATION.ay },
      markerB: { x: CALIBRATION.bx, y: CALIBRATION.by },
      distanceM: CALIBRATION.distanceM,
      pxPerM: CALIBRATION.pxPerM,
    },
    clipChecks: clipChecks(
      {
        decodable: true,
        effectiveFps: timebase.ok ? timebase.value.fps / frameStep : null,
        mode,
        irregularShare: timing.irregularShare,
        widthPx: header.widthPx,
        heightPx: header.heightPx,
        durationSec,
        calibrationPresent: true,
        athleteSelected: true,
        cameraShiftPx: 1,
      },
      config.gate,
    ),
    poseModel: { id: 'pose_landmarker_full', version: 'demo' },
    config,
    createdAt,
  }).result;
}

function shifted(
  result: AnalysisResult,
  shift: Partial<Record<MetricId, number>>,
  createdAt: string,
) {
  const move = (v: number | null, d: number) => (v === null ? null : v + d);
  return {
    ...result,
    createdAt,
    metrics: result.metrics.map((m): MetricResult => {
      const d = shift[m.id];
      if (d === undefined || m.value === null) return m;
      return {
        ...m,
        value: move(m.value, d),
        ...(m.bySide
          ? { bySide: { left: move(m.bySide.left, d), right: move(m.bySide.right, d) } }
          : {}),
      };
    }),
  };
}

/** The report snapshot, as the report builder makes it: results only, first name and initial. */
function reportSnapshot(analysisId: string, result: AnalysisResult, date: string, notes: string[]) {
  const lists = result.configSnapshot.metrics.byMode[result.mode];
  const byId = new Map(result.metrics.map((m) => [m.id, m]));
  const measured = (m: MetricResult | undefined): m is MetricResult =>
    m !== undefined && m.value !== null && m.confidence !== 'unavailable';
  const primary = lists.primary.map((id) => byId.get(id)).filter(measured);
  const secondary = lists.secondary.map((id) => byId.get(id)).filter(measured);
  const hidden = [...lists.primary, ...lists.secondary]
    .map((id) => byId.get(id))
    .filter((m): m is MetricResult => m !== undefined && !measured(m));
  const side = result.keyFrames?.side ?? 'right';
  const snapshot: ReportSnapshot = {
    schemaVersion: REPORT_SNAPSHOT_VERSION,
    title: strings.reports.titles.single,
    organisationName: ORG.name,
    athleteDisplayName: shortDisplayName(AMAHLE.first, AMAHLE.last),
    session: {
      date,
      mode: result.mode,
      place: 'Main track',
      surface: 'track',
      footwear: 'Racing flats',
    },
    analyses: [
      {
        id: analysisId,
        createdAt: result.createdAt,
        algorithmVersion: result.algorithmVersion,
        gateStatus: result.gate.status === 'pass' ? 'pass' : 'conditional',
        metrics: [...primary, ...secondary],
        primary: primary.map((m) => m.id),
        hidden: hidden.map((m) => ({ id: m.id, reasons: m.reasons })),
      },
    ],
    notes: notes.map((text) => ({ text, createdAt: `${date}T09:00:00.000Z` })),
    frames: (['ic', 'mid', 'to'] as const).map((kind, i) => ({
      ordinal: i + 1,
      label: `a1:${kind}`,
      caption: strings.keyFrames.caption(side, kind),
    })),
    generatedAt: new Date().toISOString(),
  };
  return reportSnapshotSchema.parse(snapshot);
}

/** The demo sessions, by their fixed ids (d2…01 to d2…03). */
const DEMO_SESSIONS = RUNS.map(
  (_, i) => `d2000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}`,
);

const uid = (value: string) => [sql.UniqueIdentifier, value] as const;

async function addAthlete(db: Db, a: typeof AMAHLE): Promise<void> {
  const exists = await db.query('SELECT 1 AS found FROM stride.athletes WHERE id = @id', {
    id: uid(a.id),
  });
  if (exists.length > 0)
    await db.execute('EXEC stride.delete_athlete @athlete_id = @id, @coach_id = @coach', {
      id: uid(a.id),
      coach: uid(COACH_ID),
    });
  await db.execute(
    'INSERT INTO stride.athletes (id, org_id, first_name, last_name, birth_year, created_by) VALUES (@id, @org, @first, @last, @year, @by)',
    {
      id: uid(a.id),
      org: uid(ORG.id),
      first: [sql.NVarChar(100), a.first],
      last: [sql.NVarChar(100), a.last],
      year: [sql.SmallInt, a.year],
      by: uid(COACH_ID),
    },
  );
  for (const purpose of ['analysis', 'sharing'] as const) {
    await db.execute(
      `INSERT INTO stride.consents (id, org_id, athlete_id, purpose, given_by, given_by_name, relationship, evidence, given_on, recorded_by)
       VALUES (NEWID(), @org, @athlete, @purpose, 'athlete', @name, NULL, 'paper_form', CAST(SYSUTCDATETIME() AS DATE), @by)`,
      {
        org: uid(ORG.id),
        athlete: uid(a.id),
        purpose: [sql.VarChar(12), purpose],
        name: [sql.NVarChar(200), `${a.first} ${a.last}`],
        by: uid(COACH_ID),
      },
    );
  }
}

async function addRun(
  db: Db,
  run: (typeof RUNS)[number],
  i: number,
  base: AnalysisResult,
  keypointsGz: Buffer,
  clip: Buffer,
): Promise<{ analysisId: string; result: AnalysisResult; date: string }> {
  const date = day(run.daysAgo);
  const at = `${date}T08:30:00.000Z`;
  const n = String(i + 1).padStart(2, '0');
  const ids = {
    session: `d2000000-0000-4000-8000-0000000000${n}`,
    calibration: `d3000000-0000-4000-8000-0000000000${n}`,
    clip: `d4000000-0000-4000-8000-0000000000${n}`,
    analysis: `d5000000-0000-4000-8000-0000000000${n}`,
  };
  await db.execute(
    `INSERT INTO stride.sessions (id, org_id, created_by, session_date, place, surface, footwear, mode, created_at)
     VALUES (@id, @org, @by, @date, N'Main track', 'track', N'Racing flats', 'distance', @at)`,
    {
      id: uid(ids.session),
      org: uid(ORG.id),
      by: uid(COACH_ID),
      date: [sql.Date, date],
      at: [sql.DateTime2(0), new Date(at)],
    },
  );
  await db.execute(
    `INSERT INTO stride.calibrations (id, org_id, session_id, distance_m, marker_ax, marker_ay, marker_bx, marker_by, px_per_m, frame_width, frame_height)
     VALUES (@id, @org, @session, @distance, @ax, @ay, @bx, @by, @scale, 1920, 1080)`,
    {
      id: uid(ids.calibration),
      org: uid(ORG.id),
      session: uid(ids.session),
      distance: [sql.Decimal(6, 3), CALIBRATION.distanceM],
      ax: [sql.Real, CALIBRATION.ax],
      ay: [sql.Real, CALIBRATION.ay],
      bx: [sql.Real, CALIBRATION.bx],
      by: [sql.Real, CALIBRATION.by],
      scale: [sql.Real, CALIBRATION.pxPerM],
    },
  );
  await db.execute(
    `INSERT INTO stride.clips (id, org_id, session_id, athlete_id, role, calibration_id, device_model, declared_fps, detected_fps, width_px, height_px, frame_count, duration_sec, codec, direction, fingerprint)
     VALUES (@id, @org, @session, @athlete, 'run', @calibration, N'Demo phone', 240, 240, 1920, 1080, 594, 2.475, 'avc1', 1, @fingerprint)`,
    {
      id: uid(ids.clip),
      org: uid(ORG.id),
      session: uid(ids.session),
      athlete: uid(AMAHLE.id),
      calibration: uid(ids.calibration),
      fingerprint: [sql.Char(64), fingerprint(clip)],
    },
  );
  const result = shifted(base, run.shift, at);
  await insertAnalysis(db, ORG.id, COACH_ID, ids.analysis, {
    clipId: ids.clip,
    athleteId: AMAHLE.id,
    result,
  });
  await db.execute('UPDATE stride.analyses SET created_at = @at WHERE id = @id', {
    id: uid(ids.analysis),
    at: [sql.DateTime2(0), new Date(at)],
  });
  await setKeypoints(db, ids.analysis, new Uint8Array(keypointsGz));
  await audit(db, {
    orgId: ORG.id,
    coachId: COACH_ID,
    action: 'analysis.save',
    targetType: 'analysis',
    targetId: ids.analysis,
  });
  for (const [j, body] of run.notes.entries()) {
    const noteId = `d6000000-0000-4000-8000-000000000${n}${j}`;
    await upsertNote(db, ORG.id, COACH_ID, noteId, { analysisId: ids.analysis, body });
    await db.execute('UPDATE stride.notes SET created_at = @at, updated_at = @at WHERE id = @id', {
      id: uid(noteId),
      at: [sql.DateTime2(0), new Date(`${date}T09:0${j}:00.000Z`)],
    });
  }
  return { analysisId: ids.analysis, result, date };
}

const keypointsGz = readFileSync(here('../fixtures/keypoints/distance-ltr.skp1.gz'));
const runClip = readFileSync(here('../fixtures/clips/synthetic-run-240fps.mp4'));
const frames = (['ic', 'mid', 'to'] as const).map((k) =>
  readFileSync(here(`./demo/key-frame-${k}.jpg`)),
);

const database = createDatabase(settings);
let shareUrl = '';
try {
  await database.withOrg(ORG.id, async (db) => {
    await addAthlete(db, AMAHLE);
    await addAthlete(db, PIETER);
    // Deleting an athlete keeps the sessions (a session can hold several athletes): clear the
    // demo sessions left by an earlier run.
    await db.execute(
      `DELETE FROM stride.calibrations WHERE session_id IN (SELECT CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids));
DELETE FROM stride.sessions WHERE id IN (SELECT CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids));`,
      { ids: [sql.NVarChar(sql.MAX), JSON.stringify(DEMO_SESSIONS)] },
    );
    const base = analyseTestRun(keypointsGz, new Date().toISOString());
    let latest: Awaited<ReturnType<typeof addRun>> | null = null;
    for (const [i, run] of RUNS.entries())
      latest = await addRun(db, run, i, base, keypointsGz, runClip);
    if (!latest) throw new Error('no runs');

    const reportId = 'd7000000-0000-4000-8000-000000000001';
    const lastNotes = RUNS[RUNS.length - 1]?.notes.slice(0, 1) ?? [];
    const snapshot = reportSnapshot(latest.analysisId, latest.result, latest.date, lastNotes);
    await upsertReport(db, {
      orgId: ORG.id,
      coachId: COACH_ID,
      id: reportId,
      athleteId: AMAHLE.id,
      snapshot,
    });
    await audit(db, {
      orgId: ORG.id,
      coachId: COACH_ID,
      action: 'report.create',
      targetType: 'report',
      targetId: reportId,
    });
    for (const [i, jpeg] of frames.entries())
      await putFrame(db, ORG.id, reportId, i + 1, new Uint8Array(jpeg));
    const { token, hash } = newToken();
    await insertShare(db, {
      orgId: ORG.id,
      id: reportId,
      hash,
      snapshot,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await audit(db, {
      orgId: ORG.id,
      coachId: COACH_ID,
      action: 'share.create',
      targetType: 'report',
      targetId: reportId,
    });
    shareUrl = `${WEB_ORIGIN}/r/${token}`;
  });
} finally {
  await database.close();
}

console.log(`
Demo profile ready in ${ORG.name}. Sign in as ${COACH.email} (${COACH.name}).
  ${AMAHLE.first} ${AMAHLE.last}: three saved runs (${RUNS.map((r) => day(r.daysAgo)).join(', ')}), notes, a report and a share link
  ${PIETER.first} ${PIETER.last}: consent recorded, nothing else yet
Test videos (synthetic, no real person):
  ${here('../fixtures/clips/synthetic-calibration-240fps.mp4')}  calibration, cones 5 m apart
  ${here('../fixtures/clips/synthetic-run-240fps.mp4')}  run, filmed at 240 fps
Share link of Amahle's report (shown only now; open it in a private window):
  ${shareUrl}
`);
