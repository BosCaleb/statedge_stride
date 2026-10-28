import { randomUUID } from 'node:crypto';
import type { RouteName } from '@stride/shared/api/routes';
import { CoachDirectory } from '../lib/auth';
import { createServices, setServices } from '../lib/services';
import { callRoute, testConfig, testSigner, type CallInit, type CallResult } from './api';
import { adminDatabase, apiDatabase, createTestOrg, type TestOrg } from './db';
import '../functions/routes';

// One API instance per test file, wired to SQL Server as the API identity, with tokens signed
// by a local key in place of Entra.

export interface Harness {
  admin: ReturnType<typeof adminDatabase>;
  /** A new organisation with one admin and one coach. */
  org(name?: string, maxCoaches?: number): Promise<TestOrg>;
  /** Calls a route with a token for this identity (oid, and optionally email). */
  as(
    identity: { oid: string; email?: string; name?: string },
    name: RouteName,
    init?: CallInit,
  ): Promise<CallResult>;
  token(identity: { oid: string; email?: string; name?: string }): Promise<string>;
  close(): Promise<void>;
}

export async function harness(now: () => Date = () => new Date()): Promise<Harness> {
  const config = testConfig();
  const signer = await testSigner(config);
  const api = apiDatabase();
  const admin = adminDatabase();
  setServices(
    createServices(config, {
      db: api,
      verifier: signer.verifier,
      coaches: new CoachDirectory(api),
      now,
    }),
  );
  const token = (identity: { oid: string; email?: string; name?: string }) =>
    signer.sign({
      oid: identity.oid,
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.name ? { name: identity.name } : {}),
    });
  return {
    admin,
    org: (name = `Org ${randomUUID().slice(0, 8)}`, maxCoaches = 5) =>
      createTestOrg(admin, name, maxCoaches),
    token,
    async as(identity, name, init = {}) {
      return callRoute(name, { ...init, token: await token(identity) });
    },
    async close() {
      setServices(null);
      await api.close();
      await admin.close();
    },
  };
}

export const adminOf = (org: TestOrg) => ({ oid: org.adminOid });
export const coachOf = (org: TestOrg) => ({ oid: org.coachOid });
