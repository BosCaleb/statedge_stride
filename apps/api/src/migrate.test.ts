import { describe, expect, it } from 'vitest';
import { parseGrants } from './migrate';

describe('migrate --grant', () => {
  it('reads a name, with the Entra id to create the user from when one is given', () => {
    expect(
      parseGrants([
        'id-stride-dev-san-api=00112233-4455-6677-8899-aabbccddeeff',
        'founder@statedge.co.za',
      ]),
    ).toEqual([
      { name: 'id-stride-dev-san-api', id: '00112233-4455-6677-8899-aabbccddeeff' },
      { name: 'founder@statedge.co.za', id: null },
    ]);
  });

  it('refuses an id that is not a GUID, and an empty name', () => {
    expect(() => parseGrants(['someone@statedge.co.za=not-a-guid'])).toThrow(/not a GUID/);
    expect(() => parseGrants(['=00112233-4455-6677-8899-aabbccddeeff'])).toThrow();
  });
});
