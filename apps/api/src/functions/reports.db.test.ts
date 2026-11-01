import { randomUUID } from 'node:crypto';
import { runSynthetic } from '@stride/analysis/testing/runSynthetic';
import { generateGait } from '@stride/analysis/testing/syntheticGait';
import { auditPageSchema } from '@stride/shared/api/org';
import {
  athleteReportsSchema,
  publicReportSchema,
  reportSchema,
  shareCreatedSchema,
} from '@stride/shared/api/reports';
import type { ReportSnapshot } from '@stride/shared/reportSnapshot';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callRoute } from '../test/api';
import type { TestOrg } from '../test/db';
import { adminOf, coachOf, harness, type Harness } from '../test/harness';

// Reports and share links (M5): saving a report and its key frames, the athlete's report list,
// creating a link (sharing consent, frames uploaded, first name and initial only), the public
// copy and its frames, revoking, replacing, expiry, and that expired, revoked and unknown links
// answer alike.

let h: Harness;
let a: TestOrg;
let b: TestOrg;
/** The API's clock, moved forward by the expiry test. */
let clockOffsetMs = 0;
const thisYear = new Date().getUTCFullYear();

const gait = generateGait({ noisePx: 1 });
const result = runSynthetic(gait, { mode: 'distance' }).result;
/** A tiny but well-formed JPEG header is enough: the API checks the start-of-image marker. */
const jpeg = (fill: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 64 }, () => fill), 0xff, 0xd9]);

beforeAll(async () => {
  h = await harness(() => new Date(Date.now() + clockOffsetMs));
  a = await h.org('Report School A');
  b = await h.org('Report Club B');
});
afterAll(() => h.close());

interface Saved {
  athleteId: string;
  analysisId: string;
}

async function consent(org: TestOrg, athleteId: string, purpose: 'analysis' | 'sharing') {
  const res = await h.as(coachOf(org), 'putConsent', {
    params: { id: randomUUID() },
    body: {
      athleteId,
      purpose,
      givenBy: 'athlete',
      givenByName: 'Lerato Molefe',
      relationship: null,
      evidence: 'paper_form',
      givenOn: '2026-03-01',
    },
  });
  expect(res.status).toBe(201);
}

/** An adult athlete with an analysis consent and one saved analysis. */
async function savedAnalysis(org: TestOrg, sharing = true): Promise<Saved> {
  const athleteId = randomUUID();
  expect(
    (
      await h.as(coachOf(org), 'putAthlete', {
        params: { id: athleteId },
        body: { firstName: 'Lerato', lastName: 'Molefe', birthYear: thisYear - 25 },
      })
    ).status,
  ).toBe(201);
  await consent(org, athleteId, 'analysis');
  if (sharing) await consent(org, athleteId, 'sharing');
  const sessionId = randomUUID();
  await h.as(coachOf(org), 'putSession', {
    params: { id: sessionId },
    body: { sessionDate: '2026-03-14', mode: 'distance' },
  });
  const calibrationId = randomUUID();
  const calibration = await h.as(coachOf(org), 'putCalibration', {
    params: { id: calibrationId },
    body: {
      sessionId,
      distanceM: 5,
      markerA: { x: 400, y: 900 },
      markerB: { x: 1150, y: 901 },
      pxPerM: 150,
      frameWidth: 1920,
      frameHeight: 1080,
    },
  });
  expect(calibration.status, calibration.text).toBe(201);
  const clipId = randomUUID();
  const clip = await h.as(coachOf(org), 'putClip', {
    params: { id: clipId },
    body: {
      sessionId,
      athleteId,
      role: 'run',
      calibrationId,
      deviceModel: 'Pixel 7',
      declaredFps: 240,
      detectedFps: 239.76,
      widthPx: 1920,
      heightPx: 1080,
      frameCount: gait.frames.length,
      durationSec: gait.frames.length / 240,
      codec: 'vp09.00.40.08',
      direction: 1,
      fingerprint: 'b'.repeat(64),
    },
  });
  expect(clip.status, clip.text).toBe(201);
  const analysisId = randomUUID();
  const saved = await h.as(coachOf(org), 'putAnalysis', {
    params: { id: analysisId },
    body: { clipId, athleteId, result },
  });
  expect(saved.status, saved.text).toBe(201);
  return { athleteId, analysisId };
}

function snapshot(s: Saved, overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    schemaVersion: 1,
    title: 'Running technique report',
    organisationName: 'Report School A',
    athleteDisplayName: 'Lerato Molefe',
    session: { date: '2026-03-14', mode: 'distance', place: 'Main track' },
    analyses: [
      {
        id: s.analysisId,
        createdAt: new Date().toISOString(),
        algorithmVersion: result.algorithmVersion,
        gateStatus: 'pass',
        metrics: result.metrics.slice(0, 3),
        primary: result.metrics.slice(0, 2).map((m) => m.id),
        hidden: [],
      },
    ],
    notes: [{ text: 'Relaxed shoulders today.', createdAt: new Date().toISOString() }],
    frames: [
      { ordinal: 1, label: 'right:ic', caption: 'Right foot, initial contact' },
      { ordinal: 2, label: 'right:mid', caption: 'Right foot, mid-stance' },
    ],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function putReport(org: TestOrg, s: Saved, id = randomUUID(), body = snapshot(s)) {
  const res = await h.as(coachOf(org), 'putReport', {
    params: { id },
    body: { athleteId: s.athleteId, snapshot: body },
  });
  return { id, res };
}

async function uploadFrames(org: TestOrg, id: string) {
  for (const ordinal of [1, 2]) {
    const res = await h.as(coachOf(org), 'putReportFrame', {
      params: { id, ordinal: String(ordinal) },
      body: jpeg(ordinal),
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(res.status).toBe(201);
  }
}

async function share(org: TestOrg, id: string, expiresInDays?: number) {
  return h.as(coachOf(org), 'createShare', {
    params: { id },
    body: expiresInDays === undefined ? {} : { expiresInDays },
  });
}

const tokenOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);
const open = (token: string) => h.as({ oid: randomUUID() }, 'publicReport', { params: { token } });
/** The public routes are called without a token. */
const openPublic = (token: string) => callRoute('publicReport', { params: { token } });
const openFrame = (token: string, ordinal: number) =>
  callRoute('publicReportFrame', { params: { token, ordinal: String(ordinal) } });
/** A problem body without its request id, to compare two refusals. */
const problem = (json: unknown) => {
  const { requestId: _ignored, ...rest } = json as Record<string, unknown>;
  return rest;
};

describe('reports', () => {
  it('are saved once and updated after, with one audit entry', async () => {
    const s = await savedAnalysis(a);
    const { id, res } = await putReport(a, s);
    expect(res.status).toBe(201);
    const report = reportSchema.parse(res.json);
    expect(report).toMatchObject({ id, athleteId: s.athleteId, frameOrdinals: [], share: null });

    const again = await putReport(a, s, id, snapshot(s, { title: 'Second look' }));
    expect(again.res.status).toBe(200);
    expect(reportSchema.parse(again.res.json).title).toBe('Second look');

    const got = await h.as(coachOf(a), 'getReport', { params: { id } });
    expect(reportSchema.parse(got.json).snapshot.title).toBe('Second look');
    const log = auditPageSchema.parse((await h.as(adminOf(a), 'listAudit')).json);
    expect(log.items.filter((e) => e.action === 'report.create' && e.targetId === id)).toHaveLength(
      1,
    );
  });

  it('cover saved analyses of their own athlete only', async () => {
    const s = await savedAnalysis(a);
    const other = await savedAnalysis(a);
    const mixed = await putReport(a, s, randomUUID(), {
      ...snapshot(s),
      analyses: snapshot(other).analyses,
    });
    expect(mixed.res.status).toBe(400);

    const { id } = await putReport(a, s);
    const moved = await putReport(a, other, id, snapshot(other));
    expect(moved.res.status).toBe(409);
  });

  it('stay inside the organisation', async () => {
    const s = await savedAnalysis(a);
    const { id } = await putReport(a, s);
    expect((await h.as(coachOf(b), 'getReport', { params: { id } })).status).toBe(404);
    expect(
      (
        await h.as(coachOf(b), 'putReportFrame', {
          params: { id, ordinal: '1' },
          body: jpeg(1),
          headers: { 'content-type': 'image/jpeg' },
        })
      ).status,
    ).toBe(404);
    expect((await share(b, id)).status).toBe(404);
    expect((await h.as(coachOf(b), 'revokeShare', { params: { id } })).status).toBe(404);
    // Another organisation cannot take the id over either.
    const theirs = await savedAnalysis(b);
    expect((await putReport(b, theirs, id, snapshot(theirs))).res.status).toBe(409);
    // Nor reach the athlete's report list.
    const list = await h.as(coachOf(b), 'listAthleteReports', { params: { id: s.athleteId } });
    expect(list.status).toBe(404);
  });

  it('take JPEG frames for the frames they name', async () => {
    const s = await savedAnalysis(a);
    const { id } = await putReport(a, s);
    const frame = (ordinal: string, body: Uint8Array, type = 'image/jpeg') =>
      h.as(coachOf(a), 'putReportFrame', {
        params: { id, ordinal },
        body,
        headers: { 'content-type': type },
      });
    expect((await frame('3', jpeg(3))).status).toBe(400);
    expect((await frame('6', jpeg(6))).status).toBe(400);
    expect((await frame('1', new TextEncoder().encode('not a picture'))).status).toBe(400);
    expect((await frame('1', jpeg(1), 'image/png')).status).toBe(400);
    expect((await frame('1', jpeg(1))).status).toBe(201);
    expect((await frame('1', jpeg(9))).status).toBe(200);
    const big = new Uint8Array(300 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect((await frame('2', big)).status).toBe(413);
    const got = reportSchema.parse((await h.as(coachOf(a), 'getReport', { params: { id } })).json);
    expect(got.frameOrdinals).toEqual([1]);
  });

  it('are listed per athlete, newest first, with any link expiry', async () => {
    const s = await savedAnalysis(a);
    const first = await putReport(a, s);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await putReport(a, s);
    await uploadFrames(a, second.id);
    expect((await share(a, second.id)).status).toBe(201);
    const list = athleteReportsSchema.parse(
      (await h.as(coachOf(a), 'listAthleteReports', { params: { id: s.athleteId } })).json,
    );
    expect(list.items.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(list.items[0]).toMatchObject({
      analysisIds: [s.analysisId],
      mode: 'distance',
      sessionDate: '2026-03-14',
    });
    expect(list.items[0]?.share).not.toBeNull();
    expect(list.items[1]?.share).toBeNull();
  });
});

describe('share links', () => {
  it('need a sharing consent and every frame uploaded', async () => {
    const noConsent = await savedAnalysis(a, false);
    const r1 = await putReport(a, noConsent);
    await uploadFrames(a, r1.id);
    const refused = await share(a, r1.id);
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: 'consent_required' });

    const s = await savedAnalysis(a);
    const r2 = await putReport(a, s);
    expect((await share(a, r2.id)).status).toBe(400);
    expect((await share(a, r2.id, 91)).status).toBe(400);
  });

  it('show a first name and initial copy, only what the report selected', async () => {
    const s = await savedAnalysis(a);
    const { id } = await putReport(a, s);
    await uploadFrames(a, id);
    const created = await share(a, id, 14);
    expect(created.status).toBe(201);
    const link = shareCreatedSchema.parse(created.json);
    expect(link.url).toMatch(/^http:\/\/localhost:5173\/r\/[A-Za-z0-9_-]{43}$/);
    const days = (Date.parse(link.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    const token = tokenOf(link.url);
    const res = await openPublic(token);
    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    const shared = publicReportSchema.parse(res.json);
    expect(shared.snapshot.athleteDisplayName).toBe('Lerato M.');
    expect(shared.expiresAt).toBe(link.expiresAt);
    expect(res.text).not.toContain('Molefe');
    expect(res.text).not.toContain(String(thisYear - 25));
    expect(shared.snapshot.notes.map((n) => n.text)).toEqual(['Relaxed shoulders today.']);

    const frame = await openFrame(token, 2);
    expect(frame.status).toBe(200);
    expect(frame.headers['content-type']).toBe('image/jpeg');
    expect(Array.from(frame.bytes)).toEqual(Array.from(jpeg(2)));
    expect((await openFrame(token, 3)).status).toBe(404);

    // The coach's own report keeps the name style it was saved with.
    const own = reportSchema.parse((await h.as(coachOf(a), 'getReport', { params: { id } })).json);
    expect(own.snapshot.athleteDisplayName).toBe('Lerato Molefe');
    expect(own.share?.expiresAt).toBe(link.expiresAt);
    // A signed-in caller gets the same public copy.
    expect((await open(token)).status).toBe(200);
  });

  it('look the same once revoked, replaced, expired, or never made', async () => {
    const s = await savedAnalysis(a);
    const { id } = await putReport(a, s);
    await uploadFrames(a, id);
    const unknown = await openPublic('x'.repeat(43));
    expect(unknown.status).toBe(404);
    expect(problem(unknown.json)).toMatchObject({ detail: 'This link is no longer available.' });

    // Replaced: a new link retires the old one.
    const old = tokenOf(shareCreatedSchema.parse((await share(a, id)).json).url);
    const current = tokenOf(shareCreatedSchema.parse((await share(a, id)).json).url);
    const replaced = await openPublic(old);
    expect(replaced.status).toBe(404);
    expect(problem(replaced.json)).toEqual(problem(unknown.json));
    expect((await openFrame(old, 1)).status).toBe(404);
    expect((await openPublic(current)).status).toBe(200);

    // Revoked: the public copy and its frames are gone, and the report says so.
    expect((await h.as(coachOf(a), 'revokeShare', { params: { id } })).status).toBe(204);
    const revoked = await openPublic(current);
    expect(problem(revoked.json)).toEqual(problem(unknown.json));
    expect((await openFrame(current, 1)).status).toBe(404);
    const report = reportSchema.parse(
      (await h.as(coachOf(a), 'getReport', { params: { id } })).json,
    );
    expect(report.share).toBeNull();
    expect((await h.as(coachOf(a), 'revokeShare', { params: { id } })).status).toBe(204);
    const log = auditPageSchema.parse((await h.as(adminOf(a), 'listAudit')).json);
    const mine = log.items.filter((e) => e.targetId === id);
    expect(mine.filter((e) => e.action === 'share.create')).toHaveLength(2);
    expect(mine.filter((e) => e.action === 'share.revoke')).toHaveLength(1);

    // Expired: past its date, the link answers like the others.
    const short = tokenOf(shareCreatedSchema.parse((await share(a, id, 1)).json).url);
    expect((await openPublic(short)).status).toBe(200);
    clockOffsetMs = 2 * 86_400_000;
    try {
      const expired = await openPublic(short);
      expect(expired.status).toBe(404);
      expect(problem(expired.json)).toEqual(problem(unknown.json));
      expect((await openFrame(short, 1)).status).toBe(404);
    } finally {
      clockOffsetMs = 0;
    }
  });

  it('go when the athlete is deleted', async () => {
    const s = await savedAnalysis(a);
    const { id } = await putReport(a, s);
    await uploadFrames(a, id);
    const token = tokenOf(shareCreatedSchema.parse((await share(a, id)).json).url);
    const deleted = await h.as(adminOf(a), 'deleteAthlete', {
      params: { id: s.athleteId },
      body: { confirmName: 'Lerato Molefe' },
    });
    expect(deleted.status).toBe(204);
    expect((await openPublic(token)).status).toBe(404);
    expect((await h.as(coachOf(a), 'getReport', { params: { id } })).status).toBe(404);
  });
});
