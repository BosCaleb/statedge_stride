import {
  CoachDirectory,
  entraVerifier,
  fakeVerifier,
  type CoachLookup,
  type TokenVerifier,
} from './auth';
import { loadConfig, RATE_LIMITS, type ApiConfig } from './config';
import { createDatabase, type Database } from './db';
import { RateLimiter } from './rateLimit';

// The long-lived objects one Function App instance shares between requests. Built on first use,
// so that a bad setting fails the request (and the deploy health check) rather than the host.

export interface Services {
  config: ApiConfig;
  db: Database;
  verifier: TokenVerifier;
  coaches: CoachLookup;
  coachLimit: RateLimiter;
  publicLimit: RateLimiter;
  now: () => Date;
}

export function createServices(
  config: ApiConfig,
  overrides: Partial<Omit<Services, 'config'>> = {},
): Services {
  const db = overrides.db ?? createDatabase(config.db);
  const real = overrides.verifier ?? entraVerifier(config.entra);
  return {
    config,
    db,
    verifier: config.fakeAuth ? fakeVerifier(real) : real,
    coaches: overrides.coaches ?? new CoachDirectory(db),
    coachLimit: overrides.coachLimit ?? new RateLimiter(RATE_LIMITS.perCoach),
    publicLimit: overrides.publicLimit ?? new RateLimiter(RATE_LIMITS.perIpOnPublicRoutes),
    now: overrides.now ?? (() => new Date()),
  };
}

let current: Services | null = null;

export function services(): Services {
  current ??= createServices(loadConfig());
  return current;
}

/** Tests install their own services, and reset them with null. */
export function setServices(next: Services | null): void {
  current = next;
}
