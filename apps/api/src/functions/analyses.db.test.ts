import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { encodeSkp1 } from '@stride/analysis/skp1';
import { runSynthetic } from '@stride/analysis/testing/runSynthetic';
import { generateGait, type SyntheticClip } from '@stride/analysis/testing/syntheticGait';
import {
  analysisSchema,
  analysisSummarySchema,
  athleteAnalysesPageSchema,
  noteSchema,
} from '@stride/shared/api/analyses';
import { auditPageSchema } from '@stride/shared/api/org';
import { calibrationSchema, clipSchema } from '@stride/shared/api/sessions';
import type { AnalysisResult } from '@stride/shared/analysisResult';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestOrg } from '../test/db';
import { adminOf, coachOf, harness, type Harness } from '../test/harness';

// Saving results (M4): calibrations, clips, analyses with the server-side rules, keypoints,
// history, notes and deletion, inside the organisation boundary.

let h: Harness;
let a: TestOrg;
let b: TestOrg;
const thisYear = new Date().getUTCFullYear();

const gait: SyntheticClip = generateGait({ noisePx: 1 });
const distance = runSynthetic(gait, { mode: 'distance' }).result;
const sprint = runSynthetic(generateGait({ noisePx: 1, seed: 7 }), { mode: 'sprint' }).result;
const keypoints = gzipSync(
  encodeSkp1({
    widthPx: 1920,
    heightPx: 1080,
    mirrored: false,
    timesSec: gait.timesSec,
    frames: gait.frames.map((f) => f.landmarks),
  }),
);

beforeAll(async () => {
  h = await harness();
  a = await h.org('Results School A');
  b = await h.org('Results Club B');
});
afterAll(() => h.close());

interface Setup {
  athleteId: string;
  sessionId: string;
  calibrationId: string;
  clipId: string;
}

async function athleteWithConsent(
  org: TestOrg,
  birthYear = thisYear - 25,
  consent: 'athlete' | 'guardian' | null = birthYear > thisYear - 19 ? 'guardian' : 'athlete',
): Promise<string> {
  const athleteId = randomUUID();
  await h.as(coachOf(org), 'putAthlete', {
    params: { id: athleteId },
    body: { firstName: 'Lerato', lastName: 'Molefe', birthYear },
  });
  if (consent) {
    const res = await h.as(coachOf(org), 'putConsent', {
      params: { id: randomUUID() },
      body: {
        athleteId,
        purpose: 'analysis',
        givenBy: consent,
        givenByName: 'Grace Molefe',
        relationship: consent === 'guardian' ? 'Mother' : null,
        evidence: 'paper_form',
        givenOn: '2026-03-01',
      },
    });
    expect(res.status).toBe(201);
  }
  return athleteId;
}

const calibrationBody = (sessionId: string) => ({
  sessionId,
  distanceM: 5,
  markerA: { x: 400.123456789, y: 900.5 },
  markerB: { x: 1150.987654321, y: 901.25 },
  pxPerM: 150.172839506,
  frameWidth: 1920,
  frameHeight: 1080,
});

const clipBody = (s: Pick<Setup, 'sessionId' | 'athleteId' | 'calibrationId'>) => ({
  sessionId: s.sessionId,
  athleteId: s.athleteId,
  role: 'run',
  calibrationId: s.calibrationId,
  deviceModel: 'Pixel 7',
  declaredFps: 240,
  detectedFps: 239.76,
  widthPx: 1920,
  heightPx: 1080,
  frameCount: gait.frames.length,
  durationSec: gait.frames.length / 240,
  codec: 'vp09.00.40.08',
  direction: 1,
  fingerprint: 'a'.repeat(64),
});

async function setup(org: TestOrg, athleteId?: string): Promise<Setup> {
  const athlete = athleteId ?? (await athleteWithConsent(org));
  const sessionId = randomUUID();
  await h.as(coachOf(org), 'putSession', {
    params: { id: sessionId },
    body: { sessionDate: '2026-03-14', mode: 'distance' },
  });
  const calibrationId = randomUUID();
  expect(
    (
      await h.as(coachOf(org), 'putCalibration', {
        params: { id: calibrationId },
        body: calibrationBody(sessionId),
      })
    ).status,
  ).toBe(201);
  const clipId = randomUUID();
  const clip = await h.as(coachOf(org), 'putClip', {
    params: { id: clipId },
    body: clipBody({ sessionId, athleteId: athlete, calibrationId }),
  });
  expect(clip.status).toBe(201);
  return { athleteId: athlete, sessionId, calibrationId, clipId };
}

const save = (org: TestOrg, s: Setup, result: AnalysisResult = distance, id = randomUUID()) =>
  h
    .as(coachOf(org), 'putAnalysis', {
      params: { id },
      body: { clipId: s.clipId, athleteId: s.athleteId, result },
    })
    .then((res) => ({ id, res }));

describe('calibrations and clips', () => {
  it('are written once: a repeat answers 200 and different content 409', async () => {
    const s = await setup(a);
    const again = await h.as(coachOf(a), 'putCalibration', {
      params: { id: s.calibrationId },
      body: calibrationBody(s.sessionId),
    });
    expect(again.status).toBe(200);
    expect(calibrationSchema.parse(again.json)).toMatchObject({ distanceM: 5, frameWidth: 1920 });
    const moved = await h.as(coachOf(a), 'putCalibration', {
      params: { id: s.calibrationId },
      body: { ...calibrationBody(s.sessionId), distanceM: 6 },
    });
    expect(moved.status).toBe(409);

    const clipAgain = await h.as(coachOf(a), 'putClip', {
      params: { id: s.clipId },
      body: clipBody(s),
    });
    expect(clipAgain.status).toBe(200);
    expect(clipSchema.parse(clipAgain.json)).toMatchObject({ role: 'run', declaredFps: 240 });
    const changed = await h.as(coachOf(a), 'putClip', {
      params: { id: s.clipId },
      body: { ...clipBody(s), declaredFps: 120 },
    });
    expect(changed.status).toBe(409);
    expect((await h.as(coachOf(a), 'getClip', { params: { id: s.clipId } })).json).toMatchObject({
      id: s.clipId,
      fingerprint: 'a'.repeat(64),
    });
  });

  it('need their session, athlete and calibration in the organisation and session', async () => {
    const s = await setup(a);
    const other = await setup(a);
    expect(
      (
        await h.as(coachOf(a), 'putCalibration', {
          params: { id: randomUUID() },
          body: calibrationBody(randomUUID()),
        })
      ).status,
    ).toBe(404);
    // A calibration of another session.
    expect(
      (
        await h.as(coachOf(a), 'putClip', {
          params: { id: randomUUID() },
          body: clipBody({ ...s, calibrationId: other.calibrationId }),
        })
      ).status,
    ).toBe(404);
    // A run needs an athlete, and a calibration clip has none.
    expect(
      (
        await h.as(coachOf(a), 'putClip', {
          params: { id: randomUUID() },
          body: { ...clipBody(s), athleteId: null },
        })
      ).status,
    ).toBe(400);
    const calibrationClip = await h.as(coachOf(a), 'putClip', {
      params: { id: randomUUID() },
      body: { ...clipBody(s), role: 'calibration', athleteId: null },
    });
    expect(calibrationClip.status).toBe(201);
  });
});

describe('saving an analysis', () => {
  it('stores the result once, with a metric row per measured metric', async () => {
    const s = await setup(a);
    const { id, res } = await save(a, s);
    expect(res.status).toBe(201);
    expect(analysisSummarySchema.parse(res.json)).toMatchObject({
      id,
      clipId: s.clipId,
      sessionId: s.sessionId,
      mode: 'distance',
      gateStatus: distance.gate.status,
      hasKeypoints: false,
      createdBy: a.coachId,
      supersededBy: null,
    });
    expect((await save(a, s, distance, id)).res.status).toBe(200);
    const different = await save(a, s, { ...distance, createdAt: '2026-01-01T00:00:00.000Z' }, id);
    expect(different.res.status).toBe(409);

    const full = analysisSchema.parse(
      (await h.as(coachOf(a), 'getAnalysis', { params: { id } })).json,
    );
    expect(full.result).toEqual(distance);
    expect(full.notes).toEqual([]);
    const history = athleteAnalysesPageSchema.parse(
      (await h.as(coachOf(a), 'athleteAnalyses', { params: { id: s.athleteId } })).json,
    );
    const measured = distance.metrics.filter(
      (m) => m.value !== null && m.confidence !== 'unavailable',
    );
    expect(history.items[0]?.metrics.map((m) => m.metricId).sort()).toEqual(
      measured.map((m) => m.id).sort(),
    );
    const cadence = history.items[0]?.metrics.find((m) => m.metricId === 'cadence');
    expect(cadence?.value).toBeCloseTo(
      distance.metrics.find((m) => m.id === 'cadence')?.value ?? 0,
      3,
    );
    const auditLog = auditPageSchema.parse((await h.as(adminOf(a), 'listAudit')).json);
    expect(auditLog.items.some((e) => e.action === 'analysis.save' && e.targetId === id)).toBe(
      true,
    );
  });

  it('refuses a result that failed the quality gate', async () => {
    const s = await setup(a);
    const failed = runSynthetic(gait, { mode: 'distance', cameraShiftPx: 40 }).result;
    expect(failed.gate.status).toBe('fail');
    const { res } = await save(a, s, failed);
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ code: 'gate_failed' });
  });

  it('needs an active analysis consent, from a guardian for a minor', async () => {
    const none = await setup(a, await athleteWithConsent(a, thisYear - 25, null));
    expect((await save(a, none)).res.json).toMatchObject({ code: 'consent_required' });

    const minor = await setup(a, await athleteWithConsent(a, thisYear - 14, 'guardian'));
    expect((await save(a, minor)).res.status).toBe(201);

    // An adult who consented themselves, whose birth year is then corrected to a minor's.
    const adult = await athleteWithConsent(a, thisYear - 25, 'athlete');
    const corrected = await setup(a, adult);
    await h.as(coachOf(a), 'putAthlete', {
      params: { id: adult },
      body: { firstName: 'Lerato', lastName: 'Molefe', birthYear: thisYear - 15 },
    });
    expect((await save(a, corrected)).res.json).toMatchObject({ code: 'consent_required' });
  });

  it('stops saving once the consent is withdrawn', async () => {
    const s = await setup(a);
    const consents = (await h.as(coachOf(a), 'listConsents', { params: { id: s.athleteId } }))
      .json as { items: { id: string }[] };
    const consentId = consents.items[0]?.id ?? '';
    await h.as(coachOf(a), 'withdrawConsent', { params: { id: consentId } });
    expect((await save(a, s)).res.json).toMatchObject({ code: 'consent_required' });
  });

  it('refuses implausible values and a clip of another athlete', async () => {
    const s = await setup(a);
    const absurd = {
      ...distance,
      metrics: distance.metrics.map((m) => (m.id === 'cadence' ? { ...m, value: 1000 } : m)),
    };
    const { res } = await save(a, s, absurd);
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ code: 'validation' });
    const someoneElse = await athleteWithConsent(a);
    const wrong = await h.as(coachOf(a), 'putAnalysis', {
      params: { id: randomUUID() },
      body: { clipId: s.clipId, athleteId: someoneElse, result: distance },
    });
    expect(wrong.status).toBe(400);
    const missing = await h.as(coachOf(a), 'putAnalysis', {
      params: { id: randomUUID() },
      body: { clipId: randomUUID(), athleteId: s.athleteId, result: distance },
    });
    expect(missing.status).toBe(404);
  });

  it('replaces an earlier analysis of the same clip, and history shows the current one', async () => {
    const s = await setup(a);
    const first = await save(a, s);
    const second = await h.as(coachOf(a), 'putAnalysis', {
      params: { id: randomUUID() },
      body: { clipId: s.clipId, athleteId: s.athleteId, result: distance, supersedes: first.id },
    });
    expect(second.status).toBe(201);
    const secondId = analysisSummarySchema.parse(second.json).id;
    const history = athleteAnalysesPageSchema.parse(
      (await h.as(coachOf(a), 'athleteAnalyses', { params: { id: s.athleteId } })).json,
    );
    expect(history.items.map((i) => i.id)).toEqual([secondId]);
    const old = analysisSchema.parse(
      (await h.as(coachOf(a), 'getAnalysis', { params: { id: first.id } })).json,
    );
    expect(old.supersededBy).toBe(secondId);

    // Deleting the replacement makes the earlier analysis current again.
    expect((await h.as(coachOf(a), 'deleteAnalysis', { params: { id: secondId } })).status).toBe(
      204,
    );
    const after = athleteAnalysesPageSchema.parse(
      (await h.as(coachOf(a), 'athleteAnalyses', { params: { id: s.athleteId } })).json,
    );
    expect(after.items.map((i) => i.id)).toEqual([first.id]);
  });
});

describe('keypoints', () => {
  it('are uploaded once, checked against the clip, and downloaded as stored', async () => {
    const s = await setup(a);
    const { id } = await save(a, s);
    expect((await h.as(coachOf(a), 'getKeypoints', { params: { id } })).status).toBe(404);
    const up = await h.as(coachOf(a), 'putKeypoints', { params: { id }, body: keypoints });
    expect(up.status).toBe(201);
    expect(up.json).toEqual({ bytes: keypoints.byteLength });
    expect(
      (await h.as(coachOf(a), 'putKeypoints', { params: { id }, body: keypoints })).status,
    ).toBe(200);
    const other = gzipSync(Buffer.concat([Buffer.from(keypoints), Buffer.from([0])]));
    expect((await h.as(coachOf(a), 'putKeypoints', { params: { id }, body: other })).status).toBe(
      409,
    );
    const down = await h.as(coachOf(a), 'getKeypoints', { params: { id } });
    expect(down.status).toBe(200);
    expect(Buffer.from(down.bytes).equals(Buffer.from(keypoints))).toBe(true);
    const summary = analysisSchema.parse(
      (await h.as(coachOf(a), 'getAnalysis', { params: { id } })).json,
    );
    expect(summary.hasKeypoints).toBe(true);
  });

  it('refuse files that are not gzip, do not match the clip, or expand too far', async () => {
    const s = await setup(a);
    const { id } = await save(a, s);
    const plain = await h.as(coachOf(a), 'putKeypoints', {
      params: { id },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(plain.status).toBe(400);
    const shorter = gzipSync(
      encodeSkp1({
        widthPx: 1920,
        heightPx: 1080,
        mirrored: false,
        timesSec: gait.timesSec.slice(0, 10),
        frames: gait.frames.slice(0, 10).map((f) => f.landmarks),
      }),
    );
    expect((await h.as(coachOf(a), 'putKeypoints', { params: { id }, body: shorter })).status).toBe(
      400,
    );
    const bomb = gzipSync(Buffer.alloc(25 * 1024 * 1024));
    expect(bomb.byteLength).toBeLessThan(100 * 1024);
    expect((await h.as(coachOf(a), 'putKeypoints', { params: { id }, body: bomb })).status).toBe(
      400,
    );
  });
});

describe('history', () => {
  it('lists newest session first, filters by mode, and pages', async () => {
    const athleteId = await athleteWithConsent(a);
    const ids: string[] = [];
    for (const [date, result] of [
      ['2026-01-10', distance],
      ['2026-02-10', sprint],
      ['2026-03-10', distance],
    ] as const) {
      const s = await setup(a, athleteId);
      await h.as(coachOf(a), 'putSession', {
        params: { id: s.sessionId },
        body: { sessionDate: date, mode: result.mode },
      });
      ids.push((await save(a, s, result)).id);
    }
    const all = athleteAnalysesPageSchema.parse(
      (
        await h.as(coachOf(a), 'athleteAnalyses', {
          params: { id: athleteId },
          query: { limit: '2' },
        })
      ).json,
    );
    expect(all.items.map((i) => i.sessionDate)).toEqual(['2026-03-10', '2026-02-10']);
    const rest = athleteAnalysesPageSchema.parse(
      (
        await h.as(coachOf(a), 'athleteAnalyses', {
          params: { id: athleteId },
          query: { limit: '2', cursor: all.nextCursor ?? '' },
        })
      ).json,
    );
    expect(rest.items.map((i) => i.id)).toEqual([ids[0]]);
    expect(rest.nextCursor).toBeNull();
    const sprints = athleteAnalysesPageSchema.parse(
      (
        await h.as(coachOf(a), 'athleteAnalyses', {
          params: { id: athleteId },
          query: { mode: 'sprint' },
        })
      ).json,
    );
    expect(sprints.items.map((i) => i.id)).toEqual([ids[1]]);
  });
});

describe('notes', () => {
  it('are created, edited with last write wins, and deleted', async () => {
    const s = await setup(a);
    const { id: analysisId } = await save(a, s);
    const noteId = randomUUID();
    const created = await h.as(coachOf(a), 'putNote', {
      params: { id: noteId },
      body: { analysisId, body: 'Lands on the heel ahead of the hips.' },
    });
    expect(created.status).toBe(201);
    const edited = await h.as(adminOf(a), 'putNote', {
      params: { id: noteId },
      body: { analysisId, body: 'Landing closer to the hips after the drill.' },
    });
    expect(edited.status).toBe(200);
    expect(noteSchema.parse(edited.json)).toMatchObject({
      body: 'Landing closer to the hips after the drill.',
      coachId: a.coachId,
    });
    const full = analysisSchema.parse(
      (await h.as(coachOf(a), 'getAnalysis', { params: { id: analysisId } })).json,
    );
    expect(full.notes.map((n) => n.id)).toEqual([noteId]);
    expect(
      (
        await h.as(coachOf(a), 'putNote', {
          params: { id: randomUUID() },
          body: { analysisId: randomUUID(), body: 'Nowhere' },
        })
      ).status,
    ).toBe(404);
    expect((await h.as(coachOf(a), 'deleteNote', { params: { id: noteId } })).status).toBe(204);
    expect((await h.as(coachOf(a), 'deleteNote', { params: { id: noteId } })).status).toBe(404);
  });
});

describe('deleting an analysis', () => {
  it('removes it with its notes and metric rows, and is audited', async () => {
    const s = await setup(a);
    const { id } = await save(a, s);
    await h.as(coachOf(a), 'putNote', {
      params: { id: randomUUID() },
      body: { analysisId: id, body: 'A note' },
    });
    expect((await h.as(coachOf(a), 'deleteAnalysis', { params: { id } })).status).toBe(204);
    expect((await h.as(coachOf(a), 'getAnalysis', { params: { id } })).status).toBe(404);
    expect((await h.as(coachOf(a), 'deleteAnalysis', { params: { id } })).status).toBe(404);
    const history = athleteAnalysesPageSchema.parse(
      (await h.as(coachOf(a), 'athleteAnalyses', { params: { id: s.athleteId } })).json,
    );
    expect(history.items).toEqual([]);
    const auditLog = auditPageSchema.parse((await h.as(adminOf(a), 'listAudit')).json);
    expect(auditLog.items.some((e) => e.action === 'analysis.delete' && e.targetId === id)).toBe(
      true,
    );
  });
});

describe('the organisation boundary', () => {
  it('lets organisation B read, change or delete nothing of organisation A’s results', async () => {
    const s = await setup(a);
    const { id } = await save(a, s);
    const outsider = coachOf(b);
    expect((await h.as(outsider, 'getAnalysis', { params: { id } })).status).toBe(404);
    expect((await h.as(outsider, 'getKeypoints', { params: { id } })).status).toBe(404);
    expect((await h.as(outsider, 'putKeypoints', { params: { id }, body: keypoints })).status).toBe(
      404,
    );
    expect(
      (
        await h.as(outsider, 'putNote', {
          params: { id: randomUUID() },
          body: { analysisId: id, body: 'From B' },
        })
      ).status,
    ).toBe(404);
    expect((await h.as(outsider, 'deleteAnalysis', { params: { id } })).status).toBe(404);
    expect((await h.as(outsider, 'athleteAnalyses', { params: { id: s.athleteId } })).status).toBe(
      404,
    );
    expect((await h.as(outsider, 'getClip', { params: { id: s.clipId } })).status).toBe(404);
    // B's own athlete and session, but A's clip: not found.
    const bSetup = await setup(b);
    const crossed = await h.as(outsider, 'putAnalysis', {
      params: { id: randomUUID() },
      body: { clipId: s.clipId, athleteId: bSetup.athleteId, result: distance },
    });
    expect(crossed.status).toBe(404);
    // A's calibration id reused by B.
    const reused = await h.as(outsider, 'putCalibration', {
      params: { id: s.calibrationId },
      body: calibrationBody(bSetup.sessionId),
    });
    expect(reused.status).toBe(409);
    expect((await h.as(coachOf(a), 'getAnalysis', { params: { id } })).status).toBe(200);
  });
});
