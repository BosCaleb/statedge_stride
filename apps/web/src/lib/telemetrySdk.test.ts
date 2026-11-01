import { afterEach, describe, expect, it, vi } from 'vitest';
import { initTelemetry, setTelemetryClient, trackError, trackEvent } from './telemetry';

// The real SDK with this app's settings, sending to a fake ingestion endpoint: what actually
// leaves the phone. Checks that the initialiser runs on every item and the SDK adds no user or
// session identifiers and no page views.

const CONNECTION =
  'InstrumentationKey=00000000-0000-4000-8000-000000000000;IngestionEndpoint=https://ingest.test/';

afterEach(() => {
  setTelemetryClient(null);
  vi.unstubAllGlobals();
});

describe('telemetry with the Application Insights SDK', () => {
  it('sends scrubbed items only', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push(typeof init?.body === 'string' ? init.body : '');
        return Promise.resolve(new Response('{"itemsReceived":1,"itemsAccepted":1,"errors":[]}'));
      }),
    );
    const xhrSend = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(function (
      this: XMLHttpRequest,
      body,
    ) {
      bodies.push(typeof body === 'string' ? body : '');
    });
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (_url: string, data: unknown) => {
        bodies.push(String(data));
        return true;
      },
    });
    window.history.replaceState(null, '', '/r/secret-share-token?utm=1');
    initTelemetry(CONNECTION, { batchMs: 100 });
    trackEvent({ name: 'device_check', result: 'pass', phoneFamily: 'iPhone' });
    trackError(new Error('boom /invite/abc?x=1'), 'dev-CODE');
    await vi.waitFor(
      () => {
        expect(bodies.join('\n')).toContain('device_check');
        expect(bodies.join('\n')).toContain('dev-CODE');
      },
      { timeout: 10_000, interval: 100 },
    );
    xhrSend.mockRestore();
    const sent = bodies.join('\n');
    expect(sent).not.toMatch(/secret-share-token|utm=|x=1|ai\.user\.id|ai\.session\.id/);
    expect(sent).not.toMatch(/Pageview/i);
    expect(sent).toContain('/invite/:token');
    expect(sent).toContain('"phoneFamily":"iPhone"');
    expect(sent).toContain('"supportCode":"dev-CODE"');
  }, 30_000);
});
