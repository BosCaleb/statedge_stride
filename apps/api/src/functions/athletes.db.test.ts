import { randomUUID } from 'node:crypto';
import {
  athletePageSchema,
  athleteSchema,
  consentListSchema,
  consentSchema,
} from '@stride/shared/api/athletes';
import { athleteExportSchema } from '@stride/shared/api/export';
import { auditPageSchema } from '@stride/shared/api/org';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestOrg } from '../test/db';
import { adminOf, coachOf, harness, type Harness } from '../test/harness';

// Athletes and consent, including the organisation boundary: the acceptance criteria for M2.

let h: Harness;
let a: TestOrg;
let b: TestOrg;

beforeAll(async () => {
  h = await harness();
  a = await h.org('Athlete School A');
  b = await h.org('Athlete Club B');
});
afterAll(() => h.close());

const thisYear = new Date().getUTCFullYear();
const minor = { firstName: 'Lerato', lastName: 'Molefe', birthYear: thisYear - 14 };
const adult = { firstName: 'Johan', lastName: 'van Wyk', birthYear: thisYear - 25 };

async function putAthlete(org: TestOrg, body = minor, id: string = randomUUID()) {
  const res = await h.as(coachOf(org), 'putAthlete', { params: { id }, body });
  return { id, res };
}

function consent(athleteId: string, overrides: Record<string, unknown> = {}) {
  return {
    athleteId,
    purpose: 'analysis',
    givenBy: 'guardian',
    givenByName: 'Grace Molefe',
    relationship: 'Mother',
    evidence: 'paper_form',
    givenOn: '2026-03-01',
    ...overrides,
  };
}

describe('athletes', () => {
  it('creates with 201, repeats with 200, and updates with last write wins', async () => {
    const { id, res } = await putAthlete(a);
    expect(res.status).toBe(201);
    expect(athleteSchema.parse(res.json)).toMatchObject({
      id,
      firstName: 'Lerato',
      consents: { analysis: null },
    });
    const again = await h.as(coachOf(a), 'putAthlete', { params: { id }, body: minor });
    expect(again.status).toBe(200);
    const renamed = await h.as(adminOf(a), 'putAthlete', {
      params: { id },
      body: { ...minor, firstName: 'Lerato M' },
    });
    expect(athleteSchema.parse(renamed.json).firstName).toBe('Lerato M');
    const audit = auditPageSchema.parse((await h.as(adminOf(a), 'listAudit')).json);
    expect(
      audit.items.filter((e) => e.action === 'athlete.create' && e.targetId === id),
    ).toHaveLength(1);
  });

  it('lists by name, searches, and pages with a cursor', async () => {
    const club = await h.org('Search Club');
    for (const lastName of ['Adams', 'Botha', 'Cele', 'Dlamini', 'Botes']) {
      await putAthlete(club, { firstName: 'Sam', lastName, birthYear: 2000 });
    }
    const first = athletePageSchema.parse(
      (await h.as(coachOf(club), 'listAthletes', { query: { limit: '2' } })).json,
    );
    expect(first.items.map((x) => x.lastName)).toEqual(['Adams', 'Botes']);
    const rest = athletePageSchema.parse(
      (
        await h.as(coachOf(club), 'listAthletes', {
          query: { limit: '10', cursor: first.nextCursor ?? '' },
        })
      ).json,
    );
    expect(rest.items.map((x) => x.lastName)).toEqual(['Botha', 'Cele', 'Dlamini']);
    expect(rest.nextCursor).toBeNull();
    const found = athletePageSchema.parse(
      (await h.as(coachOf(club), 'listAthletes', { query: { q: 'bot' } })).json,
    );
    expect(found.items.map((x) => x.lastName)).toEqual(['Botes', 'Botha']);
    const wildcard = athletePageSchema.parse(
      (await h.as(coachOf(club), 'listAthletes', { query: { q: '%' } })).json,
    );
    expect(wildcard.items).toEqual([]);
  });
});

describe('consent', () => {
  it('needs a guardian for a minor, and refuses verbal or digital evidence for one', async () => {
    const { id } = await putAthlete(a);
    const byAthlete = await h.as(coachOf(a), 'putConsent', {
      params: { id: randomUUID() },
      body: consent(id, { givenBy: 'athlete', givenByName: 'Lerato Molefe', relationship: null }),
    });
    expect(byAthlete.status).toBe(400);
    expect(byAthlete.json).toMatchObject({
      code: 'validation',
      errors: [{ path: 'body.givenBy' }],
    });
    const verbal = await h.as(coachOf(a), 'putConsent', {
      params: { id: randomUUID() },
      body: consent(id, { evidence: 'verbal' }),
    });
    expect(verbal.json).toMatchObject({ errors: [{ path: 'body.evidence' }] });
    const digital = await h.as(coachOf(a), 'putConsent', {
      params: { id: randomUUID() },
      body: consent(id, { evidence: 'digital' }),
    });
    expect(digital.status).toBe(400);
  });

  it('records a guardian consent for a minor, which shows on the athlete', async () => {
    const { id } = await putAthlete(a);
    const consentId = randomUUID();
    const res = await h.as(coachOf(a), 'putConsent', {
      params: { id: consentId },
      body: consent(id),
    });
    expect(res.status).toBe(201);
    expect(consentSchema.parse(res.json)).toMatchObject({
      purpose: 'analysis',
      givenBy: 'guardian',
      withdrawnAt: null,
    });
    const athlete = athleteSchema.parse(
      (await h.as(coachOf(a), 'getAthlete', { params: { id } })).json,
    );
    expect(athlete.consents.analysis?.id).toBe(consentId);
    expect(athlete.consents.sharing).toBeNull();
  });

  it('lets an adult consent verbally', async () => {
    const { id } = await putAthlete(a, adult);
    const res = await h.as(coachOf(a), 'putConsent', {
      params: { id: randomUUID() },
      body: consent(id, {
        givenBy: 'athlete',
        givenByName: 'Johan van Wyk',
        relationship: null,
        evidence: 'verbal',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('is immutable: the same request repeats, a different one conflicts', async () => {
    const { id } = await putAthlete(a);
    const consentId = randomUUID();
    expect(
      (await h.as(coachOf(a), 'putConsent', { params: { id: consentId }, body: consent(id) }))
        .status,
    ).toBe(201);
    expect(
      (await h.as(coachOf(a), 'putConsent', { params: { id: consentId }, body: consent(id) }))
        .status,
    ).toBe(200);
    const changed = await h.as(coachOf(a), 'putConsent', {
      params: { id: consentId },
      body: consent(id, { givenByName: 'Someone Else' }),
    });
    expect(changed.json).toMatchObject({ code: 'conflict' });
    const second = await h.as(coachOf(a), 'putConsent', {
      params: { id: randomUUID() },
      body: consent(id),
    });
    expect(second.json).toMatchObject({ code: 'conflict' });
  });

  it('withdrawal ends the consent, keeps the history, and allows a new one', async () => {
    const { id } = await putAthlete(a);
    const consentId = randomUUID();
    await h.as(coachOf(a), 'putConsent', { params: { id: consentId }, body: consent(id) });
    const withdrawn = await h.as(coachOf(a), 'withdrawConsent', { params: { id: consentId } });
    expect(consentSchema.parse(withdrawn.json).withdrawnAt).not.toBeNull();
    const again = await h.as(coachOf(a), 'withdrawConsent', { params: { id: consentId } });
    expect(consentSchema.parse(again.json).withdrawnAt).toBe(
      consentSchema.parse(withdrawn.json).withdrawnAt,
    );
    const athlete = athleteSchema.parse(
      (await h.as(coachOf(a), 'getAthlete', { params: { id } })).json,
    );
    expect(athlete.consents.analysis).toBeNull();
    expect(
      (await h.as(coachOf(a), 'putConsent', { params: { id: randomUUID() }, body: consent(id) }))
        .status,
    ).toBe(201);
    const history = consentListSchema.parse(
      (await h.as(coachOf(a), 'listConsents', { params: { id } })).json,
    );
    expect(history.items).toHaveLength(2);
    const audit = auditPageSchema.parse(
      (await h.as(adminOf(a), 'listAudit', { query: { limit: '10' } })).json,
    );
    expect(audit.items.map((e) => e.action)).toContain('consent.withdraw');
    expect(audit.items.some((e) => (e.detail ?? '').includes('Molefe'))).toBe(false);
  });
});

describe('deleting an athlete', () => {
  it('is for administrators, who must repeat the name', async () => {
    const { id } = await putAthlete(a);
    await h.as(coachOf(a), 'putConsent', { params: { id: randomUUID() }, body: consent(id) });
    expect(
      (
        await h.as(coachOf(a), 'deleteAthlete', {
          params: { id },
          body: { confirmName: 'Lerato Molefe' },
        })
      ).status,
    ).toBe(403);
    const wrong = await h.as(adminOf(a), 'deleteAthlete', {
      params: { id },
      body: { confirmName: 'Lerato' },
    });
    expect(wrong.status).toBe(400);
    const res = await h.as(adminOf(a), 'deleteAthlete', {
      params: { id },
      body: { confirmName: '  lerato   MOLEFE ' },
    });
    expect(res.status).toBe(204);
    expect((await h.as(coachOf(a), 'getAthlete', { params: { id } })).status).toBe(404);
    expect((await h.as(coachOf(a), 'listConsents', { params: { id } })).status).toBe(404);
    const audit = auditPageSchema.parse((await h.as(adminOf(a), 'listAudit')).json);
    expect(
      audit.items.find((e) => e.action === 'athlete.delete' && e.targetId === id),
    ).toBeDefined();
  });
});

describe('export', () => {
  it('gives an administrator everything held about the athlete, and audits it', async () => {
    const { id } = await putAthlete(a);
    await h.as(coachOf(a), 'putConsent', { params: { id: randomUUID() }, body: consent(id) });
    expect((await h.as(coachOf(a), 'exportAthlete', { params: { id } })).status).toBe(403);
    const res = await h.as(adminOf(a), 'exportAthlete', { params: { id } });
    expect(res.status).toBe(200);
    const data = athleteExportSchema.parse(res.json);
    expect(data.athlete).toMatchObject({ id, firstName: 'Lerato', lastName: 'Molefe' });
    expect(data.consents).toHaveLength(1);
    expect(data.organisation.id).toBe(a.orgId);
    const audit = auditPageSchema.parse((await h.as(adminOf(a), 'listAudit')).json);
    expect(audit.items[0]).toMatchObject({ action: 'export.athlete', targetId: id });
  });
});

describe('the organisation boundary', () => {
  it('lets organisation B read, change, list or delete nothing of organisation A', async () => {
    const { id } = await putAthlete(a);
    const consentId = randomUUID();
    await h.as(coachOf(a), 'putConsent', { params: { id: consentId }, body: consent(id) });
    const outsider = coachOf(b);
    expect((await h.as(outsider, 'getAthlete', { params: { id } })).status).toBe(404);
    expect((await h.as(outsider, 'listConsents', { params: { id } })).status).toBe(404);
    expect((await h.as(outsider, 'withdrawConsent', { params: { id: consentId } })).status).toBe(
      404,
    );
    expect(
      (await h.as(outsider, 'putAthlete', { params: { id }, body: adult })).json,
    ).toMatchObject({ code: 'conflict' });
    expect(
      (await h.as(outsider, 'putConsent', { params: { id: randomUUID() }, body: consent(id) }))
        .status,
    ).toBe(404);
    expect((await h.as(adminOf(b), 'exportAthlete', { params: { id } })).status).toBe(404);
    expect(
      (
        await h.as(adminOf(b), 'deleteAthlete', {
          params: { id },
          body: { confirmName: 'Lerato Molefe' },
        })
      ).status,
    ).toBe(404);
    const list = athletePageSchema.parse(
      (await h.as(outsider, 'listAthletes', { query: { limit: '100' } })).json,
    );
    expect(list.items.some((x) => x.id === id)).toBe(false);
    // Still intact for organisation A.
    const mine = athleteSchema.parse(
      (await h.as(coachOf(a), 'getAthlete', { params: { id } })).json,
    );
    expect(mine.firstName).toBe('Lerato');
    expect(mine.consents.analysis?.withdrawnAt).toBeNull();
  });
});
