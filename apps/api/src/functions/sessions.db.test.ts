import { randomUUID } from 'node:crypto';
import { deviceCheckSchema, deviceProfileListSchema } from '@stride/shared/api/devices';
import { sessionDetailSchema, sessionPageSchema, sessionSchema } from '@stride/shared/api/sessions';
import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callRoute } from '../test/api';
import { insertAthlete, type TestOrg } from '../test/db';
import { adminOf, coachOf, harness, type Harness } from '../test/harness';

// Sessions and device checks: the API side of M3.

let h: Harness;
let a: TestOrg;
let b: TestOrg;

beforeAll(async () => {
  h = await harness();
  a = await h.org('Session School A');
  b = await h.org('Session Club B');
});
afterAll(() => h.close());

const track = { sessionDate: '2026-03-14', place: 'Main track', surface: 'track', mode: 'sprint' };

async function putSession(org: TestOrg, body: Record<string, unknown> = track) {
  const id = randomUUID();
  const res = await h.as(coachOf(org), 'putSession', { params: { id }, body });
  return { id, res };
}

/** Clips arrive with M4's routes; until then the tests write them directly. */
async function insertClip(org: TestOrg, sessionId: string, athleteId: string | null) {
  const clipId = randomUUID();
  const calibrationId = randomUUID();
  await h.admin.withOrg(org.orgId, async (tx) => {
    const ids = {
      org: [sql.UniqueIdentifier, org.orgId],
      session: [sql.UniqueIdentifier, sessionId],
      calibration: [sql.UniqueIdentifier, calibrationId],
    } as const;
    await tx.execute(
      `INSERT INTO stride.calibrations (id, org_id, session_id, distance_m, marker_ax, marker_ay, marker_bx, marker_by, px_per_m, frame_width, frame_height)
       VALUES (@calibration, @org, @session, 5, 100, 500, 1100, 510, 200.01, 1920, 1080)`,
      ids,
    );
    await tx.execute(
      `INSERT INTO stride.clips (id, org_id, session_id, athlete_id, role, calibration_id, declared_fps, width_px, height_px, frame_count, duration_sec)
       VALUES (@clip, @org, @session, @athlete, @role, @calibration, 240, 1920, 1080, 480, 2)`,
      {
        ...ids,
        clip: [sql.UniqueIdentifier, clipId],
        athlete: [sql.UniqueIdentifier, athleteId],
        role: [sql.VarChar(12), athleteId ? 'run' : 'calibration'],
      },
    );
  });
  return { clipId, calibrationId };
}

describe('sessions', () => {
  it('creates with 201, repeats with 200, and updates with last write wins', async () => {
    const { id, res } = await putSession(a);
    expect(res.status).toBe(201);
    expect(sessionSchema.parse(res.json)).toMatchObject({
      id,
      sessionDate: '2026-03-14',
      place: 'Main track',
      surface: 'track',
      footwear: null,
      mode: 'sprint',
      createdBy: a.coachId,
    });
    const again = await h.as(coachOf(a), 'putSession', { params: { id }, body: track });
    expect(again.status).toBe(200);
    const changed = await h.as(adminOf(a), 'putSession', {
      params: { id },
      body: { ...track, surface: 'grass', notes: 'Wind from the left' },
    });
    expect(changed.status).toBe(200);
    expect(sessionSchema.parse(changed.json)).toMatchObject({
      surface: 'grass',
      notes: 'Wind from the left',
      // The coach who created it stays the creator.
      createdBy: a.coachId,
    });
  });

  it('refuses an unknown surface or mode', async () => {
    expect((await putSession(a, { ...track, surface: 'sand' })).res.status).toBe(400);
    expect((await putSession(a, { ...track, mode: 'hurdles' })).res.status).toBe(400);
  });

  it('lists newest first, pages with a cursor, and filters by date', async () => {
    const club = await h.org('Session list club');
    const dates = ['2026-02-20', '2026-03-05', '2026-03-01', '2026-03-05'];
    for (const sessionDate of dates) await putSession(club, { ...track, sessionDate });

    const first = sessionPageSchema.parse(
      (await h.as(coachOf(club), 'listSessions', { query: { limit: '2' } })).json,
    );
    expect(first.items.map((s) => s.sessionDate)).toEqual(['2026-03-05', '2026-03-05']);
    expect(first.nextCursor).not.toBeNull();
    const rest = sessionPageSchema.parse(
      (
        await h.as(coachOf(club), 'listSessions', {
          query: { limit: '2', cursor: first.nextCursor ?? '' },
        })
      ).json,
    );
    expect(rest.items.map((s) => s.sessionDate)).toEqual(['2026-03-01', '2026-02-20']);
    expect(rest.nextCursor).toBeNull();
    const seen = new Set([...first.items, ...rest.items].map((s) => s.id));
    expect(seen.size).toBe(4);

    const march = sessionPageSchema.parse(
      (
        await h.as(coachOf(club), 'listSessions', {
          query: { from: '2026-03-01', to: '2026-03-04' },
        })
      ).json,
    );
    expect(march.items.map((s) => s.sessionDate)).toEqual(['2026-03-01']);
  });

  it('refuses a cursor it did not issue', async () => {
    const res = await h.as(coachOf(a), 'listSessions', { query: { cursor: 'bm90LWEtY3Vyc29y' } });
    expect(res.status).toBe(400);
  });

  it('filters by athlete through the clips', async () => {
    const club = await h.org('Session athlete club');
    const athlete = await insertAthlete(h.admin, club);
    const other = await insertAthlete(h.admin, club, 'Johan');
    const withAthlete = await putSession(club);
    const withOther = await putSession(club);
    await putSession(club);
    await insertClip(club, withAthlete.id, athlete);
    await insertClip(club, withOther.id, other);

    const page = sessionPageSchema.parse(
      (await h.as(coachOf(club), 'listSessions', { query: { athleteId: athlete } })).json,
    );
    expect(page.items.map((s) => s.id)).toEqual([withAthlete.id]);
  });

  it('returns the session with its calibrations, clips and analysis summaries', async () => {
    const { id } = await putSession(a);
    const empty = sessionDetailSchema.parse(
      (await h.as(coachOf(a), 'getSession', { params: { id } })).json,
    );
    expect(empty).toMatchObject({ session: { id }, calibrations: [], clips: [], analyses: [] });

    const athlete = await insertAthlete(h.admin, a);
    const { clipId, calibrationId } = await insertClip(a, id, athlete);
    const analysisId = randomUUID();
    await h.admin.withOrg(a.orgId, (tx) =>
      tx.execute(
        `INSERT INTO stride.analyses (id, org_id, clip_id, athlete_id, algorithm_version, pose_model, gate_status, result_json, created_by)
         VALUES (@id, @org, @clip, @athlete, '1.0.0', 'pose_landmarker_full', 'pass', N'{"mode":"sprint"}', @by)`,
        {
          id: [sql.UniqueIdentifier, analysisId],
          org: [sql.UniqueIdentifier, a.orgId],
          clip: [sql.UniqueIdentifier, clipId],
          athlete: [sql.UniqueIdentifier, athlete],
          by: [sql.UniqueIdentifier, a.coachId],
        },
      ),
    );

    const detail = sessionDetailSchema.parse(
      (await h.as(coachOf(a), 'getSession', { params: { id } })).json,
    );
    expect(detail.calibrations).toMatchObject([
      { id: calibrationId, sessionId: id, distanceM: 5, markerA: { x: 100, y: 500 } },
    ]);
    expect(detail.clips).toMatchObject([
      { id: clipId, athleteId: athlete, role: 'run', calibrationId, declaredFps: 240 },
    ]);
    expect(detail.analyses).toMatchObject([
      {
        id: analysisId,
        clipId,
        sessionId: id,
        mode: 'sprint',
        gateStatus: 'pass',
        hasKeypoints: false,
      },
    ]);
  });

  it('keeps sessions inside their organisation', async () => {
    const { id } = await putSession(a);
    const outsider = coachOf(b);
    expect((await h.as(outsider, 'getSession', { params: { id } })).status).toBe(404);
    const listed = sessionPageSchema.parse((await h.as(outsider, 'listSessions')).json);
    expect(listed.items.some((s) => s.id === id)).toBe(false);
    const takeover = await h.as(outsider, 'putSession', {
      params: { id },
      body: { ...track, place: 'Elsewhere' },
    });
    expect(takeover.status).toBe(409);
    expect(takeover.json).toMatchObject({ code: 'conflict' });
    const still = sessionDetailSchema.parse(
      (await h.as(coachOf(a), 'getSession', { params: { id } })).json,
    );
    expect(still.session.place).toBe('Main track');
  });

  it('gives a missing session a 404', async () => {
    const res = await h.as(coachOf(a), 'getSession', { params: { id: randomUUID() } });
    expect(res.status).toBe(404);
  });
});

describe('device checks', () => {
  const check = (id: string) => ({
    id,
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
  });

  it('stores one row per id, so a repeated send changes nothing', async () => {
    const id = randomUUID();
    const first = await h.as(coachOf(a), 'postDeviceCheck', { body: check(id) });
    expect(first.status).toBe(201);
    const stored = deviceCheckSchema.parse(first.json);
    expect(stored.id).toBe(id);
    const again = await h.as(coachOf(a), 'postDeviceCheck', {
      body: { ...check(id), result: 'fail' },
    });
    expect(again.status).toBe(200);
    expect(deviceCheckSchema.parse(again.json)).toEqual(stored);
    const rows = await h.admin.withOrg(a.orgId, (tx) =>
      tx.query<{ result: string }>('SELECT result FROM stride.device_checks WHERE id = @id', {
        id: [sql.UniqueIdentifier, id],
      }),
    );
    expect(rows).toEqual([{ result: 'pass' }]);
  });

  it('refuses an id another organisation already used', async () => {
    const id = randomUUID();
    expect((await h.as(coachOf(a), 'postDeviceCheck', { body: check(id) })).status).toBe(201);
    const res = await h.as(coachOf(b), 'postDeviceCheck', { body: check(id) });
    expect(res.status).toBe(409);
  });

  it('refuses a result outside pass, conditional and fail', async () => {
    const res = await h.as(coachOf(a), 'postDeviceCheck', {
      body: { ...check(randomUUID()), result: 'great' },
    });
    expect(res.status).toBe(400);
  });

  it('lists the tested phones without a token, cacheable for an hour', async () => {
    const model = `Test phone ${randomUUID().slice(0, 8)}`;
    await h.admin.withoutOrg((tx) =>
      tx.execute(
        "INSERT INTO stride.device_profiles (model, tier, max_slowmo, notes) VALUES (@model, 'A', N'1080p 240', NULL)",
        { model: [sql.NVarChar(100), model] },
      ),
    );
    const res = await callRoute('deviceProfiles');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    const list = deviceProfileListSchema.parse(res.json);
    expect(list.items).toContainEqual(
      expect.objectContaining({ model, tier: 'A', maxSlowmo: '1080p 240', notes: null }),
    );
  });
});
