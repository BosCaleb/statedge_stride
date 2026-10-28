import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { callRoute, testConfig, testSigner } from '../test/api';
import type { Coach, CoachLookup } from './auth';
import { fakeToken } from './auth';
import type { ApiConfig } from './config';
import type { Database } from './db';
import { route } from './http';
import { RateLimiter } from './rateLimit';
import { createServices, setServices } from './services';
import '../functions/health';

// The request pipeline with a stubbed database and coach directory: no SQL Server needed.

const coachOid = randomUUID();
const adminOid = randomUUID();
const removedOid = randomUUID();
const orgId = randomUUID();
const coachOf = (role: Coach['role'], status: Coach['status'] = 'active'): Coach => ({
  id: randomUUID(),
  orgId,
  role,
  status,
  email: `${role}@example.org`,
  displayName: null,
});
const people = new Map<string, Coach>([
  [coachOid, coachOf('coach')],
  [adminOid, coachOf('admin')],
  [removedOid, coachOf('coach', 'removed')],
]);
const coaches: CoachLookup = {
  find: (oid) => Promise.resolve(people.get(oid) ?? null),
  forget: () => undefined,
};

/** A database that must never be reached by these tests. */
const noDatabase = new Proxy({} as Database, {
  get: () => () => Promise.reject(new Error('no database in unit tests')),
});

let signer: Awaited<ReturnType<typeof testSigner>>;
let config: ApiConfig;

function install(overrides: { config?: ApiConfig; publicLimit?: RateLimiter } = {}) {
  setServices(
    createServices(overrides.config ?? config, {
      db: noDatabase,
      verifier: signer.verifier,
      coaches,
      ...(overrides.publicLimit ? { publicLimit: overrides.publicLimit } : {}),
    }),
  );
}

// Stub handlers on real routes, to exercise each part of the pipeline.
route('listMembers', ({ coach }) =>
  Promise.resolve({
    body: {
      items: [],
      pendingInvites: [],
      maxCoaches: 3,
      seatsUsed: coach.role === 'admin' ? 1 : 0,
    },
  }),
);
route('putAthlete', ({ body, params }) =>
  Promise.resolve({
    created: true,
    body: {
      id: params.id,
      firstName: body.firstName,
      lastName: body.lastName,
      birthYear: body.birthYear,
      externalRef: body.externalRef ?? null,
      createdAt: '2026-03-01T10:00:00Z',
      consents: { analysis: null, sharing: null, clip_storage: null },
    },
  }),
);
route('putKeypoints', ({ body }) =>
  Promise.resolve({ created: true, body: { bytes: body.byteLength } }),
);
route('getAthlete', () => Promise.resolve({ body: { id: 'not-a-guid' } as never }));
route('getClip', () => Promise.reject(new Error('Login failed for user secret-user')));

beforeAll(async () => {
  config = testConfig();
  signer = await testSigner(config);
});
afterEach(() => setServices(null));

const athlete = { firstName: 'Ayanda', lastName: 'Mokoena', birthYear: 2009 };

describe('public routes', () => {
  it('answers health with the build version and safe headers', async () => {
    install();
    const res = await callRoute('health');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: 'ok', version: 'test-build' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.logs.some((l) => l.includes('"route":"health"') && l.includes('"status":200'))).toBe(
      true,
    );
  });

  it('sends no CORS allow header to an origin that is not allowed', async () => {
    install();
    const res = await callRoute('health', { headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate-limits public routes per client address, with Retry-After', async () => {
    install({ publicLimit: new RateLimiter(2) });
    expect((await callRoute('health')).status).toBe(200);
    expect((await callRoute('health')).status).toBe(200);
    const limited = await callRoute('health');
    expect(limited.status).toBe(429);
    expect(limited.json).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const other = await callRoute('health', { headers: { 'x-forwarded-for': '198.51.100.9:443' } });
    expect(other.status).toBe(200);
  });
});

describe('authentication', () => {
  it('needs a valid bearer token', async () => {
    install();
    const missing = await callRoute('listMembers');
    expect(missing.status).toBe(401);
    expect(missing.headers['content-type']).toBe('application/problem+json');
    expect(missing.headers['www-authenticate']).toBe('Bearer');
    expect(missing.json).toMatchObject({ code: 'unauthorised', status: 401 });
    expect((missing.json as { requestId: string }).requestId).toBeTruthy();
    expect((await callRoute('listMembers', { token: 'not-a-jwt-at-all' })).status).toBe(401);
  });

  it('checks audience, issuer, expiry and scope', async () => {
    install();
    const ok = await signer.sign({ oid: adminOid });
    expect((await callRoute('listMembers', { token: ok })).status).toBe(200);
    for (const token of [
      await signer.sign({ oid: adminOid }, { audience: 'some-other-api' }),
      await signer.sign({ oid: adminOid }, { issuer: 'https://login.example/other/v2.0' }),
      await signer.sign({ oid: adminOid }, { expiresIn: '-5m' }),
      await signer.sign({ oid: adminOid, scp: 'User.Read' }),
    ]) {
      expect((await callRoute('listMembers', { token })).status).toBe(401);
    }
  });

  it('answers not_enrolled for an unknown user and forbidden for a removed coach', async () => {
    install();
    const stranger = await callRoute('listMembers', {
      token: await signer.sign({ oid: randomUUID() }),
    });
    expect(stranger.status).toBe(403);
    expect(stranger.json).toMatchObject({ code: 'not_enrolled' });
    const removed = await callRoute('listMembers', {
      token: await signer.sign({ oid: removedOid }),
    });
    expect(removed.json).toMatchObject({ code: 'forbidden' });
  });

  it('keeps admin routes from coaches, using the role from the database', async () => {
    install();
    const res = await callRoute('listMembers', {
      token: await signer.sign({ oid: coachOid, roles: ['admin'] }),
    });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: 'forbidden' });
  });

  it('honours fake tokens only when ENVIRONMENT is local and DEV_FAKE_AUTH is true', async () => {
    const token = fakeToken({ oid: adminOid, email: 'admin@example.org' });
    install({ config: testConfig({ DEV_FAKE_AUTH: 'true' }) });
    expect((await callRoute('listMembers', { token })).status).toBe(200);
    const others: Record<string, string>[] = [
      { DEV_FAKE_AUTH: 'false' },
      { ENVIRONMENT: 'dev', SQL_AUTH: 'entra', DEV_FAKE_AUTH: 'true' },
      { ENVIRONMENT: 'prod', SQL_AUTH: 'entra', DEV_FAKE_AUTH: 'true' },
    ];
    for (const env of others) {
      install({ config: testConfig(env) });
      expect((await callRoute('listMembers', { token })).status, JSON.stringify(env)).toBe(401);
    }
  });
});

describe('request bodies', () => {
  const id = randomUUID();

  it('validates the body and answers 201 for a first create', async () => {
    install();
    const token = await signer.sign({ oid: coachOid });
    const res = await callRoute('putAthlete', { token, params: { id }, body: athlete });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ id, firstName: 'Ayanda' });
  });

  it('reports each invalid field without echoing the input', async () => {
    install();
    const token = await signer.sign({ oid: coachOid });
    const res = await callRoute('putAthlete', {
      token,
      params: { id },
      body: { ...athlete, birthYear: 1800, lastName: '' },
    });
    expect(res.status).toBe(400);
    const problem = res.json as { code: string; errors: { path: string; message: string }[] };
    expect(problem.code).toBe('validation');
    expect(problem.errors.map((e) => e.path).sort()).toEqual(['body.birthYear', 'body.lastName']);
    expect(res.text).not.toContain('Ayanda');
    expect(res.text).not.toContain('1800');
  });

  it('refuses a bad path parameter, a wrong content type and broken JSON', async () => {
    install();
    const token = await signer.sign({ oid: coachOid });
    const badId = await callRoute('putAthlete', {
      token,
      params: { id: 'athlete-1' },
      body: athlete,
    });
    expect((badId.json as { errors: { path: string }[] }).errors[0]?.path).toBe('params.id');
    const type = await callRoute('putAthlete', {
      token,
      params: { id },
      body: athlete,
      headers: { 'content-type': 'text/plain' },
    });
    expect(type.status).toBe(400);
    const broken = await callRoute('putAthlete', { token, params: { id }, body: '{"firstName": ' });
    expect(broken.status).toBe(400);
    expect(broken.json).toMatchObject({ detail: 'The body is not valid JSON' });
  });

  it('refuses a body over the limit, whatever Content-Length says', async () => {
    install();
    const token = await signer.sign({ oid: coachOid });
    const huge = { ...athlete, externalRef: 'x'.repeat(300 * 1024) };
    const res = await callRoute('putAthlete', {
      token,
      params: { id },
      body: huge,
      headers: { 'content-length': '10' },
    });
    expect(res.status).toBe(413);
    expect(res.json).toMatchObject({ code: 'payload_too_large' });
    const declared = await callRoute('putKeypoints', {
      token,
      params: { id },
      body: new Uint8Array(10),
      headers: { 'content-length': String(6 * 1024 * 1024) },
    });
    expect(declared.status).toBe(413);
  });

  it('accepts binary uploads of the declared type only', async () => {
    install();
    const token = await signer.sign({ oid: coachOid });
    const ok = await callRoute('putKeypoints', {
      token,
      params: { id },
      body: new Uint8Array(1234),
    });
    expect(ok.status).toBe(201);
    expect(ok.json).toEqual({ bytes: 1234 });
    const json = await callRoute('putKeypoints', { token, params: { id }, body: { a: 1 } });
    expect(json.status).toBe(400);
  });
});

describe('failures', () => {
  it('turns an unexpected error into a 500 with a request id and no internals', async () => {
    install();
    const token = await signer.sign({ oid: coachOid });
    const res = await callRoute('getClip', { token, params: { id: randomUUID() } });
    expect(res.status).toBe(500);
    expect(res.json).toMatchObject({ code: 'internal', status: 500 });
    expect(res.text).not.toContain('secret-user');
    expect(res.logs.some((l) => l.includes('secret-user'))).toBe(true);
  });

  it('never sends a response that fails its own schema', async () => {
    install();
    const token = await signer.sign({ oid: coachOid });
    const res = await callRoute('getAthlete', { token, params: { id: randomUUID() } });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('not-a-guid');
  });

  it('logs ids, never tokens, names or query strings', async () => {
    install();
    const token = await signer.sign({ oid: coachOid });
    const res = await callRoute('putAthlete', {
      token,
      params: { id: randomUUID() },
      body: athlete,
      query: { q: 'Mokoena' },
    });
    const line = res.logs.find((l) => l.includes('"event":"request"')) ?? '';
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry).toMatchObject({
      route: 'putAthlete',
      method: 'PUT',
      status: 201,
      orgId,
      coachId: people.get(coachOid)?.id,
    });
    expect(typeof entry.durationMs).toBe('number');
    const all = res.logs.join('\n');
    for (const secret of [token, 'Ayanda', 'Mokoena', '2009']) expect(all).not.toContain(secret);
  });
});

describe('services', () => {
  it('refuses settings that would weaken a cloud environment', () => {
    expect(() => testConfig({ ENVIRONMENT: 'prod', SQL_AUTH: 'sql' })).toThrow(/SQL_AUTH=sql/);
    expect(() => testConfig({ ALLOWED_ORIGINS: 'https://stride.example/app' })).toThrow(
      /ALLOWED_ORIGINS/,
    );
    expect(() => testConfig({ ENTRA_TENANT_ID: 'contoso' })).toThrow(/ENTRA_TENANT_ID/);
    expect(
      testConfig({ ENVIRONMENT: 'dev', SQL_AUTH: 'entra', DEV_FAKE_AUTH: 'true' }).fakeAuth,
    ).toBe(false);
  });

  it('derives the External ID issuer and key set from the tenant id', () => {
    const c = testConfig();
    expect(c.entra.issuer).toBe(
      'https://11111111-2222-4333-8444-555555555555.ciamlogin.com/11111111-2222-4333-8444-555555555555/v2.0',
    );
    expect(c.entra.jwksUri).toContain('/discovery/v2.0/keys');
  });
});
