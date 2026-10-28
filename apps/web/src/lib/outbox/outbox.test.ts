import { describe, expect, it } from 'vitest';
import { ApiProblem, NetworkError } from '../api';
import { backoffMs, memoryStorage, Outbox, type OutboxEntry } from './outbox';

const problem = (status: number, code: ApiProblem['code']) =>
  new ApiProblem({ type: 'urn:test', title: code, status, code, detail: `${code} detail` });

function setup(fail: (entry: OutboxEntry) => Error | null = () => null) {
  const sent: string[] = [];
  let clock = 1_000;
  const storage = memoryStorage();
  const outbox = new Outbox(
    storage,
    (entry) => {
      const error = fail(entry);
      if (error) return Promise.reject(error);
      sent.push(entry.label);
      return Promise.resolve({ ok: true });
    },
    { now: () => clock, random: () => 0 },
  );
  return {
    outbox,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const athlete = { type: 'athlete', id: 'a1' };

describe('outbox', () => {
  it('flushes in creation order, honouring dependencies', async () => {
    const { outbox, sent } = setup();
    await outbox.enqueue({
      route: 'putAthlete',
      params: { id: 'a1' },
      resource: athlete,
      label: 'athlete',
    });
    const consent = await outbox.enqueue({
      route: 'putConsent',
      params: { id: 'c1' },
      needs: [athlete],
      label: 'consent',
    });
    expect(consent.dependsOn).toHaveLength(1);
    await outbox.enqueue({ route: 'putSession', params: { id: 's1' }, label: 'session' });
    await outbox.flush();
    expect(sent).toEqual(['athlete', 'consent', 'session']);
    expect(await outbox.list()).toEqual([]);
  });

  it('marks permanent errors failed without retrying, and holds back what depends on them', async () => {
    const { outbox, sent } = setup((e) =>
      e.label === 'athlete' ? problem(400, 'validation') : null,
    );
    await outbox.enqueue({
      route: 'putAthlete',
      params: { id: 'a1' },
      resource: athlete,
      label: 'athlete',
    });
    await outbox.enqueue({
      route: 'putConsent',
      params: { id: 'c1' },
      needs: [athlete],
      label: 'consent',
    });
    await outbox.enqueue({ route: 'putSession', params: { id: 's1' }, label: 'session' });
    await outbox.flush();
    expect(sent).toEqual(['session']);
    const [failed, waiting] = await outbox.list();
    expect(failed).toMatchObject({
      label: 'athlete',
      state: 'failed',
      attempts: 1,
      lastError: { code: 'validation' },
    });
    expect(waiting).toMatchObject({ label: 'consent', state: 'pending' });
    await outbox.flush();
    expect(sent).toEqual(['session']);
  });

  it('retries a failed entry when asked, and discards it when asked', async () => {
    let reject = true;
    const { outbox, sent } = setup((e) =>
      e.label === 'consent' && reject ? problem(422, 'consent_required') : null,
    );
    const entry = await outbox.enqueue({
      route: 'putConsent',
      params: { id: 'c1' },
      label: 'consent',
    });
    await outbox.flush();
    expect((await outbox.list())[0]?.state).toBe('failed');
    reject = false;
    await outbox.retry(entry.id);
    expect(sent).toEqual(['consent']);
    const other = await outbox.enqueue({
      route: 'putConsent',
      params: { id: 'c2' },
      label: 'other',
    });
    await outbox.discard(other.id);
    expect(await outbox.list()).toEqual([]);
  });

  it('backs off on network errors and keeps the order', async () => {
    let offline = true;
    const { outbox, sent, advance } = setup(() =>
      offline ? new NetworkError(new TypeError('Failed to fetch')) : null,
    );
    await outbox.enqueue({ route: 'putAthlete', params: { id: 'a1' }, label: 'first' });
    await outbox.enqueue({ route: 'putSession', params: { id: 's1' }, label: 'second' });
    await outbox.flush();
    const [first] = await outbox.list();
    expect(first).toMatchObject({
      label: 'first',
      attempts: 1,
      nextAttemptAt: 2_000,
      lastError: { code: 'network' },
    });
    offline = false;
    await outbox.flush();
    expect(sent).toEqual([]);
    advance(1_000);
    await outbox.flush();
    expect(sent).toEqual(['first', 'second']);
  });

  it('sends at once when the connection comes back, without waiting out the backoff', async () => {
    let offline = true;
    const { outbox, sent } = setup(() =>
      offline ? new NetworkError(new TypeError('Failed to fetch')) : null,
    );
    await outbox.enqueue({ route: 'putSession', params: { id: 's1' }, label: 'session' });
    for (let i = 0; i < 5; i++) {
      await outbox.retry((await outbox.list())[0]?.id ?? '');
    }
    expect((await outbox.list())[0]?.nextAttemptAt).toBeGreaterThan(1_000);
    offline = false;
    await outbox.flush();
    expect(sent).toEqual([]);
    await outbox.flushNow();
    expect(sent).toEqual(['session']);
  });

  it('pauses on 401 until resumed after sign-in', async () => {
    let signedIn = false;
    const { outbox, sent } = setup(() => (signedIn ? null : problem(401, 'unauthorised')));
    await outbox.enqueue({ route: 'putAthlete', params: { id: 'a1' }, label: 'athlete' });
    await outbox.flush();
    signedIn = true;
    await outbox.flush();
    expect(sent).toEqual([]);
    await outbox.resume();
    expect(sent).toEqual(['athlete']);
  });

  it('doubles the delay from one second up to a minute, with up to 20 percent jitter', () => {
    expect([1, 2, 3, 6, 7, 20].map((n) => backoffMs(n, 0))).toEqual([
      1000, 2000, 4000, 32000, 60000, 60000,
    ]);
    expect(backoffMs(1, 1)).toBe(1200);
  });
});
