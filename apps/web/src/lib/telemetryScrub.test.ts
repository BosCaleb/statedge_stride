import { describe, expect, it } from 'vitest';
import { isAllowedItem, scrubItem, scrubText } from './telemetryScrub';

describe('telemetry scrubbing', () => {
  it('cuts query strings and fragments from URLs and paths', () => {
    expect(scrubText('https://stride.test/athletes?q=Ayanda#top')).toBe(
      'https://stride.test/athletes',
    );
    expect(scrubText('failed to load https://x.blob.core.windows.net/c/a.mp4?sig=abc then')).toBe(
      'failed to load https://x.blob.core.windows.net/c/a.mp4 then',
    );
    expect(scrubText('/athletes?search=Mokoena')).toBe('/athletes');
    expect(scrubText('at f (https://stride.test/assets/index-abc.js:1:200)')).toBe(
      'at f (https://stride.test/assets/index-abc.js:1:200)',
    );
  });

  it('hides share and invite tokens in paths', () => {
    expect(scrubText('https://stride.test/r/AbC_dEf-123')).toBe('https://stride.test/r/:token');
    expect(scrubText('/invite/ZZZ111')).toBe('/invite/:token');
    expect(scrubText('https://api.test/api/v1/public/reports/tok123/frames/2')).toBe(
      'https://api.test/api/v1/public/reports/:token/frames/2',
    );
    expect(scrubText('/athletes/6a1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22')).toBe(
      '/athletes/6a1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22',
    );
  });

  it('removes user and session ids, person fields and bodies from an item', () => {
    const item: Record<string, unknown> = {
      name: 'Microsoft.ApplicationInsights.Exception',
      baseType: 'ExceptionData',
      baseData: {
        exceptions: [{ typeName: 'Error', message: 'boom at /r/secret-token?x=1' }],
        properties: { supportCode: 'dev-1', athleteName: 'Ayanda', email: 'a@b.c' },
      },
      data: {
        build: 'dev',
        firstName: 'Ayanda',
        guardian_name: 'Thandi',
        birthYear: 2009,
        requestBody: '{}',
        phone: '082 555 0101',
        mobileNumber: '082 555 0101',
        mode: 'distance',
        phoneFamily: 'iPhone',
      },
      ext: { user: { id: 'u1', authId: 'x' }, app: { sesId: 's1' }, device: { localId: 'd' } },
      tags: [{ 'ai.user.id': 'u1', 'ai.session.id': 's1', 'ai.cloud.role': 'web' }],
    };
    scrubItem(item);
    expect(item).toEqual({
      name: 'Microsoft.ApplicationInsights.Exception',
      baseType: 'ExceptionData',
      baseData: {
        exceptions: [{ typeName: 'Error', message: 'boom at /r/:token' }],
        properties: { supportCode: 'dev-1' },
      },
      data: { build: 'dev', mode: 'distance', phoneFamily: 'iPhone' },
      ext: { app: {}, device: {} },
      tags: [{ 'ai.cloud.role': 'web' }],
    });
  });

  it('lets errors, dependencies and events through, but never page views', () => {
    expect(isAllowedItem({ baseType: 'ExceptionData' })).toBe(true);
    expect(isAllowedItem({ baseType: 'RemoteDependencyData' })).toBe(true);
    expect(isAllowedItem({ baseType: 'EventData' })).toBe(true);
    expect(isAllowedItem({ baseType: 'PageviewData' })).toBe(false);
    expect(isAllowedItem({ baseType: 'PageviewPerformanceData' })).toBe(false);
  });
});
