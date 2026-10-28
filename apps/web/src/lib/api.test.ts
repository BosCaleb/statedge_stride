import { describe, expect, it, vi } from 'vitest';
import { ApiProblem, createApiClient, NetworkError } from './api';

const athlete = {
  id: '6a1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22',
  firstName: 'Ayanda',
  lastName: 'Mokoena',
  birthYear: 2009,
  externalRef: null,
  createdAt: '2026-03-01T10:00:00Z',
  consents: { analysis: null, sharing: null, clip_storage: null },
};

function client(response: Response | Error, token: string | null = 'token-1') {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  const call = createApiClient({
    baseUrl: 'https://api.test/api',
    getToken: () => Promise.resolve(token),
    fetch,
  });
  return { call, fetch };
}

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });

describe('API client', () => {
  it('builds the path, sends the bearer token and never sends cookies', async () => {
    const { call, fetch } = client(json(athlete, 201));
    const result = await call('putAthlete', {
      params: { id: athlete.id },
      body: { firstName: 'Ayanda', lastName: 'Mokoena', birthYear: 2009 },
    });
    expect(result.status).toBe(201);
    expect(result.data.firstName).toBe('Ayanda');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.test/api/v1/athletes/${athlete.id}`);
    expect(init?.method).toBe('PUT');
    expect(init?.credentials).toBe('omit');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('adds query parameters and skips empty ones', async () => {
    const { call, fetch } = client(json({ items: [], nextCursor: null }));
    await call('listSessions', { query: { limit: 10, athleteId: undefined } });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.test/api/v1/sessions?limit=10');
  });

  it('turns problem details into an ApiProblem with the stable code', async () => {
    const problem = {
      type: 'urn:x',
      title: 'Consent required',
      status: 422,
      code: 'consent_required',
      requestId: 'r1',
    };
    const { call } = client(json(problem, 422, 'application/problem+json'));
    const error = await call('getAthlete', { params: { id: athlete.id } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblem);
    expect((error as ApiProblem).code).toBe('consent_required');
  });

  it('reports network failures and 5xx without a problem body as retryable', async () => {
    await expect(
      client(new TypeError('Failed to fetch')).call('health', {}),
    ).rejects.toBeInstanceOf(NetworkError);
    await expect(
      client(new Response('Bad gateway', { status: 502 })).call('health', {}),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('refuses to call a signed-in route without a token', async () => {
    const { call, fetch } = client(json(athlete), null);
    const error = await call('getAthlete', { params: { id: athlete.id } }).catch((e: unknown) => e);
    expect((error as ApiProblem).code).toBe('unauthorised');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a response that does not match its schema', async () => {
    const { call } = client(json({ ...athlete, id: 'not-a-guid' }));
    await expect(call('getAthlete', { params: { id: athlete.id } })).rejects.toThrow();
  });

  it('validates the body before sending it', async () => {
    const { call, fetch } = client(json(athlete));
    await expect(
      call('putAthlete', {
        params: { id: athlete.id },
        body: { firstName: '', lastName: 'M', birthYear: 2009 },
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
