import type { OrgType, Role } from './enums';

// Seeded organisations and people for local development and end-to-end tests. `pnpm seed`
// creates them; with DEV_FAKE_AUTH (API, local only) and VITE_FAKE_AUTH (web, local and test
// builds only) a developer signs in as one of them without Entra. All names are invented.

export interface DevOrg {
  id: string;
  name: string;
  type: OrgType;
  maxCoaches: number;
}

export const DEV_ORGS = {
  a: {
    id: 'a0000000-0000-4000-8000-00000000000a',
    name: 'Seeded School A',
    type: 'school',
    maxCoaches: 3,
  },
  b: {
    id: 'b0000000-0000-4000-8000-00000000000b',
    name: 'Seeded Club B',
    type: 'club',
    maxCoaches: 2,
  },
} as const satisfies Record<string, DevOrg>;

export interface DevIdentity {
  oid: string;
  email: string;
  name: string;
  /** The seeded coach record, or null for a person who still needs an invite. */
  coach: { id: string; org: keyof typeof DEV_ORGS; role: Role } | null;
}

export const DEV_IDENTITIES = [
  {
    oid: '0a000000-0000-4000-8000-000000000001',
    email: 'admin@school-a.test',
    name: 'Thandi Admin',
    coach: { id: 'ca000000-0000-4000-8000-000000000001', org: 'a', role: 'admin' },
  },
  {
    oid: '0a000000-0000-4000-8000-000000000002',
    email: 'coach@school-a.test',
    name: 'Sipho Coach',
    coach: { id: 'ca000000-0000-4000-8000-000000000002', org: 'a', role: 'coach' },
  },
  {
    oid: '0b000000-0000-4000-8000-000000000001',
    email: 'admin@club-b.test',
    name: 'Pieter Admin',
    coach: { id: 'cb000000-0000-4000-8000-000000000001', org: 'b', role: 'admin' },
  },
  {
    oid: '0c000000-0000-4000-8000-000000000001',
    email: 'new.coach@school-a.test',
    name: 'New Coach',
    coach: null,
  },
] as const satisfies readonly DevIdentity[];
