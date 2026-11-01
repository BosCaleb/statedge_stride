import { randomUUID } from 'node:crypto';
import { runSynthetic } from '@stride/analysis/testing/runSynthetic';
import { generateGait } from '@stride/analysis/testing/syntheticGait';
import { auditPageSchema, inviteCreatedSchema, membersSchema } from '@stride/shared/api/org';
import { shareCreatedSchema } from '@stride/shared/api/reports';
import type { ReportSnapshot } from '@stride/shared/reportSnapshot';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callRoute } from '../test/api';
import { apiDatabase, type TestOrg } from '../test/db';
import { adminOf, coachOf, harness, type Harness } from '../test/harness';

// The organisation boundary, swept end to end (M6). Two organisations each hold one of
// everything: athlete, consents, session, calibration, clip, analysis with metrics, note,
// report with frames, an open share link, a device check, an invite and audit rows. Then:
//   * every table with an org_id is covered by the security policy;
//   * as the API identity, in direct SQL, organisation B's context sees, changes and deletes
//     nothing of A's in any of those tables, cannot move a row into A, and no context sees
//     nothing at all;
//   * through the API, every route that takes an id answers B with A's ids as if they did not
//     exist (404), or as a conflict for an id already taken (409), and A's data is unchanged.
// The per-feature files (athletes, analyses, sessions, reports, org) test the same boundary
// next to each feature; this file makes sure no table or route is left out.

let h: Harness;
let a: TestOrg;
let b: TestOrg;
let graphA: Graph;
let graphB: Graph;
const api = apiDatabase(1);
const thisYear = new Date().getUTCFullYear();
const gait = generateGait({ noisePx: 1 });
const result = runSynthetic(gait, { mode: 'distance' }).result;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

/** The tables under row-level security, and the column that holds the organisation. */
const RLS_TABLES = [
  ['organisations', 'id'],
  ['coaches', 'org_id'],
  ['invites', 'org_id'],
  ['athletes', 'org_id'],
  ['consents', 'org_id'],
  ['sessions', 'org_id'],
  ['calibrations', 'org_id'],
  ['clips', 'org_id'],
  ['analyses', 'org_id'],
  ['analysis_metrics', 'org_id'],
  ['notes', 'org_id'],
  ['reports', 'org_id'],
  ['report_frames', 'org_id'],
  ['device_checks', 'org_id'],
  ['audit_log', 'org_id'],
] as const;

/**
 * Tables with an org_id but no row-level security, by design: public copies are reached by the
 * hash of an unguessable token, and every query on them names the organisation explicitly.
 */
const TOKEN_TABLES = ['shared_reports'];

interface Graph {
  athleteId: string;
  analysisConsentId: string;
  sharingConsentId: string;
  sessionId: string;
  calibrationId: string;
  clipId: string;
  analysisId: string;
  noteId: string;
  reportId: string;
  shareToken: string;
  deviceCheckId: string;
  inviteId: string;
}

async function ok(res: Promise<{ status: number; text: string }>, status = 201): Promise<void> {
  const r = await res;
  expect(r.status, r.text).toBe(status);
}

/** One of everything an organisation holds, made through the API as that organisation. */
async function buildGraph(org: TestOrg, name: string): Promise<Graph> {
  const as = coachOf(org);
  const g: Graph = {
    athleteId: randomUUID(),
    analysisConsentId: randomUUID(),
    sharingConsentId: randomUUID(),
    sessionId: randomUUID(),
    calibrationId: randomUUID(),
    clipId: randomUUID(),
    analysisId: randomUUID(),
    noteId: randomUUID(),
    reportId: randomUUID(),
    shareToken: '',
    deviceCheckId: randomUUID(),
    inviteId: '',
  };
  await ok(
    h.as(as, 'putAthlete', {
      params: { id: g.athleteId },
      body: { firstName: name, lastName: 'Boundary', birthYear: thisYear - 25 },
    }),
  );
  for (const [id, purpose] of [
    [g.analysisConsentId, 'analysis'],
    [g.sharingConsentId, 'sharing'],
  ] as const) {
    await ok(
      h.as(as, 'putConsent', {
        params: { id },
        body: {
          athleteId: g.athleteId,
          purpose,
          givenBy: 'athlete',
          givenByName: `${name} Boundary`,
          relationship: null,
          evidence: 'paper_form',
          givenOn: '2026-03-01',
        },
      }),
    );
  }
  await ok(
    h.as(as, 'putSession', {
      params: { id: g.sessionId },
      body: { sessionDate: '2026-03-14', mode: 'distance' },
    }),
  );
  await ok(
    h.as(as, 'putCalibration', {
      params: { id: g.calibrationId },
      body: {
        sessionId: g.sessionId,
        distanceM: 5,
        markerA: { x: 400, y: 900 },
        markerB: { x: 1150, y: 901 },
        pxPerM: 150,
        frameWidth: 1920,
        frameHeight: 1080,
      },
    }),
  );
  await ok(
    h.as(as, 'putClip', {
      params: { id: g.clipId },
      body: {
        sessionId: g.sessionId,
        athleteId: g.athleteId,
        role: 'run',
        calibrationId: g.calibrationId,
        deviceModel: 'Pixel 7',
        declaredFps: 240,
        detectedFps: 239.76,
        widthPx: 1920,
        heightPx: 1080,
        frameCount: gait.frames.length,
        durationSec: gait.frames.length / 240,
        codec: 'vp09.00.40.08',
        direction: 1,
        fingerprint: 'c'.repeat(64),
      },
    }),
  );
  await ok(
    h.as(as, 'putAnalysis', {
      params: { id: g.analysisId },
      body: { clipId: g.clipId, athleteId: g.athleteId, result },
    }),
  );
  await ok(
    h.as(as, 'putNote', {
      params: { id: g.noteId },
      body: { analysisId: g.analysisId, body: 'Relaxed shoulders.' },
    }),
  );
  await ok(
    h.as(as, 'putReport', {
      params: { id: g.reportId },
      body: { athleteId: g.athleteId, snapshot: snapshot(g, name) },
    }),
  );
  await ok(
    h.as(as, 'putReportFrame', {
      params: { id: g.reportId, ordinal: '1' },
      body: jpeg,
      headers: { 'content-type': 'image/jpeg' },
    }),
  );
  const shared = await h.as(as, 'createShare', { params: { id: g.reportId }, body: {} });
  expect(shared.status, shared.text).toBe(201);
  const url = shareCreatedSchema.parse(shared.json).url;
  g.shareToken = url.slice(url.lastIndexOf('/') + 1);
  await ok(
    h.as(as, 'postDeviceCheck', {
      body: {
        id: g.deviceCheckId,
        deviceModel: 'Pixel 7',
        os: 'Android 15',
        browser: 'Chrome 141',
        declaredFps: 240,
        detectedFps: 239.6,
        widthPx: 1280,
        heightPx: 720,
        codec: 'avc1.640028',
        timingJitter: 0.04,
        result: 'pass',
      },
    }),
  );
  const invited = await h.as(adminOf(org), 'createInvite', {
    body: { email: `${name.toLowerCase()}-new@example.org`, role: 'coach' },
  });
  expect(invited.status, invited.text).toBe(201);
  g.inviteId = inviteCreatedSchema.parse(invited.json).id;
  return g;
}

function snapshot(g: Graph, name: string): ReportSnapshot {
  return {
    schemaVersion: 1,
    title: 'Running technique report',
    organisationName: `${name} School`,
    athleteDisplayName: `${name} Boundary`,
    session: { date: '2026-03-14', mode: 'distance', place: 'Main track' },
    analyses: [
      {
        id: g.analysisId,
        createdAt: new Date().toISOString(),
        algorithmVersion: result.algorithmVersion,
        gateStatus: 'pass',
        metrics: result.metrics.slice(0, 2),
        primary: result.metrics.slice(0, 1).map((m) => m.id),
        hidden: [],
      },
    ],
    notes: [],
    frames: [{ ordinal: 1, label: 'right:ic', caption: 'Right foot, initial contact' }],
    generatedAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  h = await harness();
  a = await h.org('Boundary School A');
  b = await h.org('Boundary Club B');
  graphA = await buildGraph(a, 'Ayanda');
  graphB = await buildGraph(b, 'Bongani');
}, 120_000);

afterAll(async () => {
  await api.close();
  await h.close();
});

describe('the security policy', () => {
  it('covers every table with an organisation column, and is switched on', async () => {
    const catalog = await h.admin.withoutOrg(async (db) => ({
      withOrg: await db.query<{ name: string }>(
        `SELECT t.name FROM sys.tables t
         JOIN sys.schemas s ON s.schema_id = t.schema_id AND s.name = 'stride'
         WHERE t.name = 'organisations'
            OR EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = t.object_id AND c.name = 'org_id')
         ORDER BY t.name`,
      ),
      filtered: await db.query<{ name: string }>(
        `SELECT DISTINCT OBJECT_NAME(p.target_object_id) AS name
         FROM sys.security_predicates p
         JOIN sys.security_policies sp ON sp.object_id = p.object_id
         WHERE sp.name = 'org_isolation' AND sp.is_enabled = 1 AND p.predicate_type = 0
         ORDER BY name`,
      ),
      blockedAfterInsert: await db.query<{ name: string }>(
        `SELECT DISTINCT OBJECT_NAME(p.target_object_id) AS name
         FROM sys.security_predicates p
         JOIN sys.security_policies sp ON sp.object_id = p.object_id
         WHERE sp.name = 'org_isolation' AND p.predicate_type = 1 AND p.operation = 1
         ORDER BY name`,
      ),
    }));
    const expected = RLS_TABLES.map(([t]) => t).sort();
    expect(catalog.withOrg.map((r) => r.name)).toEqual([...expected, ...TOKEN_TABLES].sort());
    expect(catalog.filtered.map((r) => r.name)).toEqual(expected);
    expect(catalog.blockedAfterInsert.map((r) => r.name)).toEqual(expected);
  });
});

// Fixed query strings, one line per table (no SQL is assembled in code). The policy test above
// fails if a table is added without being added here too.

/** Per table: rows of the organisation in @org, and rows of any other organisation. */
const COUNTS = `SELECT t, ISNULL(mine, 0) AS mine, ISNULL(others, 0) AS others FROM (
  SELECT 'organisations', SUM(CASE WHEN id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN id <> @org THEN 1 ELSE 0 END) FROM stride.organisations
  UNION ALL SELECT 'coaches', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.coaches
  UNION ALL SELECT 'invites', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.invites
  UNION ALL SELECT 'athletes', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.athletes
  UNION ALL SELECT 'consents', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.consents
  UNION ALL SELECT 'sessions', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.sessions
  UNION ALL SELECT 'calibrations', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.calibrations
  UNION ALL SELECT 'clips', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.clips
  UNION ALL SELECT 'analyses', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.analyses
  UNION ALL SELECT 'analysis_metrics', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.analysis_metrics
  UNION ALL SELECT 'notes', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.notes
  UNION ALL SELECT 'reports', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.reports
  UNION ALL SELECT 'report_frames', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.report_frames
  UNION ALL SELECT 'device_checks', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.device_checks
  UNION ALL SELECT 'audit_log', SUM(CASE WHEN org_id = @org THEN 1 ELSE 0 END), SUM(CASE WHEN org_id <> @org THEN 1 ELSE 0 END) FROM stride.audit_log
) AS c (t, mine, others)`;

/**
 * Tries to update and delete every row of organisation @other, children first, inside a
 * savepoint that is always rolled back, so that a failure here could never cost A its data.
 */
const TOUCH_OTHER = `SAVE TRANSACTION boundary;
DECLARE @touched INT = 0;
UPDATE stride.audit_log SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.audit_log WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.device_checks SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.device_checks WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.report_frames SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.report_frames WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.reports SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.reports WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.notes SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.notes WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.analysis_metrics SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.analysis_metrics WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.analyses SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.analyses WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.clips SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.clips WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.calibrations SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.calibrations WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.sessions SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.sessions WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.consents SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.consents WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.athletes SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.athletes WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.invites SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.invites WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.coaches SET org_id = org_id WHERE org_id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.coaches WHERE org_id = @other; SET @touched += @@ROWCOUNT;
UPDATE stride.organisations SET id = id WHERE id = @other; SET @touched += @@ROWCOUNT;
DELETE FROM stride.organisations WHERE id = @other; SET @touched += @@ROWCOUNT;
ROLLBACK TRANSACTION boundary;
SELECT @touched AS touched;`;

/** Moves one row of each table into organisation @other. */
const MOVE_ONE: Record<string, string> = {
  coaches: 'UPDATE TOP (1) stride.coaches SET org_id = @other',
  invites: 'UPDATE TOP (1) stride.invites SET org_id = @other',
  athletes: 'UPDATE TOP (1) stride.athletes SET org_id = @other',
  consents: 'UPDATE TOP (1) stride.consents SET org_id = @other',
  sessions: 'UPDATE TOP (1) stride.sessions SET org_id = @other',
  calibrations: 'UPDATE TOP (1) stride.calibrations SET org_id = @other',
  clips: 'UPDATE TOP (1) stride.clips SET org_id = @other',
  analyses: 'UPDATE TOP (1) stride.analyses SET org_id = @other',
  analysis_metrics: 'UPDATE TOP (1) stride.analysis_metrics SET org_id = @other',
  notes: 'UPDATE TOP (1) stride.notes SET org_id = @other',
  reports: 'UPDATE TOP (1) stride.reports SET org_id = @other',
  report_frames: 'UPDATE TOP (1) stride.report_frames SET org_id = @other',
  device_checks: 'UPDATE TOP (1) stride.device_checks SET org_id = @other',
  audit_log: 'UPDATE TOP (1) stride.audit_log SET org_id = @other',
};

interface Counts {
  t: string;
  mine: number;
  others: number;
}

const tableNames = RLS_TABLES.map(([t]) => t).sort();

describe('direct SQL as the API identity', () => {
  it('sees nothing in any table without an organisation in context', async () => {
    const pool = await api.pool();
    const raw = await pool
      .request()
      .input('org', sql.UniqueIdentifier, b.orgId)
      .query<Counts>(COUNTS);
    expect(raw.recordset.map((r) => r.t).sort()).toEqual(tableNames);
    expect(raw.recordset.filter((r) => r.mine + r.others !== 0)).toEqual([]);
  });

  it("sees only its own organisation's rows in every table", async () => {
    const seen = await api.withOrg(b.orgId, (db) =>
      db.query<Counts>(COUNTS, { org: [sql.UniqueIdentifier, b.orgId] }),
    );
    expect(seen.map((r) => r.t).sort()).toEqual(tableNames);
    expect(seen.filter((r) => r.mine === 0 || r.others !== 0)).toEqual([]);
  });

  it("can neither change nor delete another organisation's rows in any table", async () => {
    const touched = await api.withOrg(b.orgId, (db) =>
      db.query<{ touched: number }>(TOUCH_OTHER, { other: [sql.UniqueIdentifier, a.orgId] }),
    );
    expect(touched).toEqual([{ touched: 0 }]);
  });

  it('cannot move one of its rows into another organisation in any table', async () => {
    expect(Object.keys(MOVE_ONE).sort()).toEqual(tableNames.filter((t) => t !== 'organisations'));
    for (const [table, statement] of Object.entries(MOVE_ONE)) {
      await expect(
        api.withOrg(b.orgId, (db) =>
          db.execute(statement, { other: [sql.UniqueIdentifier, a.orgId] }),
        ),
        table,
      ).rejects.toThrow(/block predicate/i);
    }
    // An organisation's key is the organisation: B cannot create another one either.
    await expect(
      api.withOrg(b.orgId, (db) =>
        db.execute("INSERT INTO stride.organisations (id, name, type) VALUES (@id, N'X', 'club')", {
          id: [sql.UniqueIdentifier, randomUUID()],
        }),
      ),
    ).rejects.toThrow(/block predicate/i);
  });

  it('A’s rows are all still there afterwards', async () => {
    const seen = await api.withOrg(a.orgId, (db) =>
      db.query<Counts>(COUNTS, { org: [sql.UniqueIdentifier, a.orgId] }),
    );
    expect(seen.filter((r) => r.mine === 0 || r.others !== 0)).toEqual([]);
  });
});

describe('every route that takes an id', () => {
  it("answers organisation B as if A's records did not exist", async () => {
    const g = graphA;
    const coach = coachOf(b);
    const admin = adminOf(b);
    const id = (value: string) => ({ params: { id: value } });
    const calls: [string, () => Promise<{ status: number }>, number][] = [
      ['getAthlete', () => h.as(coach, 'getAthlete', id(g.athleteId)), 404],
      [
        'putAthlete',
        () =>
          h.as(coach, 'putAthlete', {
            ...id(g.athleteId),
            body: { firstName: 'Taken', lastName: 'Over', birthYear: 2000 },
          }),
        409,
      ],
      ['listConsents', () => h.as(coach, 'listConsents', id(g.athleteId)), 404],
      ['withdrawConsent', () => h.as(coach, 'withdrawConsent', id(g.analysisConsentId)), 404],
      [
        'putConsent',
        () =>
          h.as(coach, 'putConsent', {
            ...id(randomUUID()),
            body: {
              athleteId: g.athleteId,
              purpose: 'analysis',
              givenBy: 'athlete',
              givenByName: 'Someone Else',
              relationship: null,
              evidence: 'paper_form',
              givenOn: '2026-03-02',
            },
          }),
        404,
      ],
      ['getSession', () => h.as(coach, 'getSession', id(g.sessionId)), 404],
      [
        'putSession',
        () =>
          h.as(coach, 'putSession', {
            ...id(g.sessionId),
            body: { sessionDate: '2026-04-01', mode: 'sprint' },
          }),
        409,
      ],
      ['getClip', () => h.as(coach, 'getClip', id(g.clipId)), 404],
      ['getAnalysis', () => h.as(coach, 'getAnalysis', id(g.analysisId)), 404],
      ['getKeypoints', () => h.as(coach, 'getKeypoints', id(g.analysisId)), 404],
      ['athleteAnalyses', () => h.as(coach, 'athleteAnalyses', id(g.athleteId)), 404],
      ['deleteAnalysis', () => h.as(coach, 'deleteAnalysis', id(g.analysisId)), 404],
      [
        'putNote (A’s note id)',
        () =>
          h.as(coach, 'putNote', {
            ...id(g.noteId),
            body: { analysisId: graphB.analysisId, body: 'Overwritten' },
          }),
        409,
      ],
      ['deleteNote', () => h.as(coach, 'deleteNote', id(g.noteId)), 404],
      ['getReport', () => h.as(coach, 'getReport', id(g.reportId)), 404],
      ['listAthleteReports', () => h.as(coach, 'listAthleteReports', id(g.athleteId)), 404],
      [
        'putReportFrame',
        () =>
          h.as(coach, 'putReportFrame', {
            params: { id: g.reportId, ordinal: '2' },
            body: jpeg,
            headers: { 'content-type': 'image/jpeg' },
          }),
        404,
      ],
      ['createShare', () => h.as(coach, 'createShare', { ...id(g.reportId), body: {} }), 404],
      ['revokeShare', () => h.as(coach, 'revokeShare', id(g.reportId)), 404],
      ['exportAthlete', () => h.as(admin, 'exportAthlete', id(g.athleteId)), 404],
      [
        'deleteAthlete',
        () =>
          h.as(admin, 'deleteAthlete', {
            ...id(g.athleteId),
            body: { confirmName: 'Ayanda Boundary' },
          }),
        404,
      ],
      ['removeMember', () => h.as(admin, 'removeMember', { params: { coachId: a.coachId } }), 404],
      ['revokeInvite', () => h.as(admin, 'revokeInvite', id(g.inviteId)), 404],
    ];
    const statuses = [];
    for (const [name, call, expected] of calls) {
      statuses.push({ name, status: (await call()).status, expected });
    }
    expect(statuses.filter((s) => s.status !== s.expected)).toEqual([]);
  });

  it("lists none of A's records to B", async () => {
    const athletes = (await h.as(coachOf(b), 'listAthletes')).text;
    const sessions = (await h.as(coachOf(b), 'listSessions')).text;
    const members = (await h.as(adminOf(b), 'listMembers')).text;
    const audit = auditPageSchema.parse((await h.as(adminOf(b), 'listAudit')).json);
    for (const text of [athletes, sessions, members]) {
      expect(text).not.toContain(graphA.athleteId);
      expect(text).not.toContain(graphA.sessionId);
      expect(text).not.toContain('Ayanda');
      expect(text).not.toContain(a.coachId);
    }
    expect(audit.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(graphA.athleteId);
  });

  it("leaves A's records and open link exactly as they were", async () => {
    const g = graphA;
    expect((await h.as(coachOf(a), 'getAthlete', { params: { id: g.athleteId } })).status).toBe(
      200,
    );
    const consents = await h.as(coachOf(a), 'listConsents', { params: { id: g.athleteId } });
    expect(consents.text).not.toContain('"withdrawnAt":"');
    expect((await h.as(coachOf(a), 'getAnalysis', { params: { id: g.analysisId } })).status).toBe(
      200,
    );
    const session = await h.as(coachOf(a), 'getSession', { params: { id: g.sessionId } });
    expect(session.text).toContain('"mode":"distance"');
    const publicCopy = await callRoute('publicReport', { params: { token: g.shareToken } });
    expect(publicCopy.status).toBe(200);
    const members = membersSchema.parse((await h.as(adminOf(a), 'listMembers')).json);
    expect(members.pendingInvites.map((i) => i.id)).toContain(g.inviteId);
    expect(members.items.map((c) => c.id)).toContain(a.coachId);
  });
});
