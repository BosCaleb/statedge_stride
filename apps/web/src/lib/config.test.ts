import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

describe('web settings', () => {
  it('derives the External ID authority from the tenant subdomain', () => {
    const c = parseConfig({
      VITE_API_BASE_URL: 'https://func-stride-dev-san.azurewebsites.net/api/',
      VITE_ENTRA_TENANT_SUBDOMAIN: 'statedgestride',
      VITE_ENTRA_CLIENT_ID: '6a1f8f3c-2d6e-4b7a-a0f4-3e5a9d1c7b22',
      VITE_API_SCOPE: 'api://0b9c2a4e-6f0d-4c39-9d64-8f6f1f0e2a11/access_as_user',
    });
    expect(c.apiBaseUrl).toBe('https://func-stride-dev-san.azurewebsites.net/api');
    expect(c.entra?.authority).toBe('https://statedgestride.ciamlogin.com/');
    expect(c.fakeAuth).toBe(false);
  });

  it('needs the Entra settings unless fake sign-in is on', () => {
    expect(() => parseConfig({ VITE_API_BASE_URL: 'https://api.test/api' })).toThrow();
    expect(() =>
      parseConfig({
        VITE_API_BASE_URL: 'https://api.test/api',
        VITE_ENTRA_TENANT_SUBDOMAIN: 'REPLACE_ME',
        VITE_ENTRA_CLIENT_ID: 'REPLACE_ME',
        VITE_API_SCOPE: 'x',
      }),
    ).toThrow();
    expect(
      parseConfig({ VITE_API_BASE_URL: 'https://api.test/api', VITE_FAKE_AUTH: 'true' }).entra,
    ).toBeNull();
  });
});
