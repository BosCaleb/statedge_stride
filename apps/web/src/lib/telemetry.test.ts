import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  phoneFamily,
  setTelemetryClient,
  trackError,
  trackEvent,
  trackFailedApiCall,
  usableConnectionString,
  type TelemetryClient,
} from './telemetry';

function fakeClient() {
  return {
    trackEvent: vi.fn<TelemetryClient['trackEvent']>(),
    trackException: vi.fn<TelemetryClient['trackException']>(),
    trackDependencyData: vi.fn<TelemetryClient['trackDependencyData']>(),
  };
}

afterEach(() => setTelemetryClient(null));

describe('telemetry', () => {
  it('sends nothing without a client (builds with no connection string)', () => {
    expect(() =>
      trackEvent({ name: 'device_check', result: 'pass', phoneFamily: 'iPhone' }),
    ).not.toThrow();
  });

  it('sends the named events with their counts and codes only', () => {
    const c = fakeClient();
    setTelemetryClient(c);
    trackEvent({
      name: 'analysis_completed',
      mode: 'sprint',
      gateStatus: 'conditional',
      durationMs: 41_000,
      frameCount: 720,
      fps: 240,
      phoneFamily: 'Android',
    });
    trackEvent({ name: 'analysis_failed', code: 'decode_failed', phoneFamily: 'iPhone' });
    expect(c.trackEvent.mock.calls).toEqual([
      [
        { name: 'analysis_completed' },
        {
          mode: 'sprint',
          gateStatus: 'conditional',
          durationMs: 41_000,
          frameCount: 720,
          fps: 240,
          phoneFamily: 'Android',
        },
      ],
      [{ name: 'analysis_failed' }, { code: 'decode_failed', phoneFamily: 'iPhone' }],
    ]);
  });

  it('sends a caught error with its support code', () => {
    const c = fakeClient();
    setTelemetryClient(c);
    const error = new Error('render failed');
    trackError(error, 'dev-20261101T1200-ABCD');
    trackError('not an error', 'dev-2');
    expect(c.trackException.mock.calls[0]?.[0]).toEqual({
      exception: error,
      properties: { supportCode: 'dev-20261101T1200-ABCD' },
    });
    expect(c.trackException.mock.calls[1]?.[0].exception.message).toBe('not an error');
  });

  it('reports a failed API call by route name, with no URL', () => {
    const c = fakeClient();
    setTelemetryClient(c);
    trackFailedApiCall({ route: 'getAthlete', method: 'GET', status: 503, durationMs: 120 });
    const sent = c.trackDependencyData.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      name: 'GET getAthlete',
      target: 'stride-api',
      responseCode: 503,
      success: false,
      duration: 120,
    });
    expect(JSON.stringify(sent)).not.toMatch(/https?:|\/v1\//);
  });

  it('only accepts a connection string the deploy filled in', () => {
    expect(usableConnectionString(undefined)).toBe(false);
    expect(usableConnectionString('REPLACE_ME')).toBe(false);
    expect(
      usableConnectionString(
        'InstrumentationKey=00000000-0000-4000-8000-000000000000;IngestionEndpoint=https://za.in.applicationinsights.azure.com/',
      ),
    ).toBe(true);
  });

  it('groups phones into families', () => {
    expect(phoneFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)')).toBe('iPhone');
    expect(phoneFamily('Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X)')).toBe('iPad');
    expect(phoneFamily('Mozilla/5.0 (Linux; Android 15; K) Chrome/140')).toBe('Android');
    expect(phoneFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
  });
});
