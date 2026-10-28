import { roleSchema, coachStatusSchema, type CoachStatus, type Role } from '@stride/shared/enums';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import sql from 'mssql';
import { z } from 'zod';
import { COACH_CACHE_MS, type ApiConfig } from './config';
import { guid, type Database } from './db';

// Bearer tokens from Entra External ID, validated with the tenant's key set (cached by jose):
// signature, issuer, audience, expiry and the access_as_user scope. The coach and their role
// come from the database, never from the token.

export interface Identity {
  /** The `oid` claim, lower case. */
  oid: string;
  /** The verified email claim, lower case, or null when the token has none. */
  email: string | null;
  name: string | null;
}

export interface TokenVerifier {
  /** The identity in a valid token, or null for any invalid one. Never throws. */
  verify(token: string): Promise<Identity | null>;
}

const claimsSchema = z.object({
  oid: z.guid(),
  scp: z.string(),
  email: z.email().max(320).optional(),
  name: z.string().max(200).optional(),
});

export function entraVerifier(entra: ApiConfig['entra'], keys?: JWTVerifyGetKey): TokenVerifier {
  const keySet =
    keys ??
    createRemoteJWKSet(new URL(entra.jwksUri), {
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, keySet, {
          issuer: entra.issuer,
          audience: entra.audience,
          algorithms: ['RS256'],
          requiredClaims: ['exp', 'oid'],
          clockTolerance: 60,
        });
        const claims = claimsSchema.safeParse(payload);
        if (!claims.success || !claims.data.scp.split(' ').includes(entra.scope)) return null;
        return {
          oid: claims.data.oid.toLowerCase(),
          email: claims.data.email?.toLowerCase() ?? null,
          name: claims.data.name ?? null,
        };
      } catch {
        return null;
      }
    },
  };
}

/** Local development and end-to-end tests only: `fake.` + base64url JSON { oid, email, name? }. */
export const FAKE_TOKEN_PREFIX = 'fake.';
const fakeClaimsSchema = z.object({
  oid: z.guid(),
  email: z.email(),
  name: z.string().max(200).optional(),
});

export function fakeToken(identity: { oid: string; email: string; name?: string }): string {
  return FAKE_TOKEN_PREFIX + Buffer.from(JSON.stringify(identity)).toString('base64url');
}

/** Accepts fake tokens first, then real ones. Built only when ENVIRONMENT=local and DEV_FAKE_AUTH=true. */
export function fakeVerifier(real: TokenVerifier): TokenVerifier {
  return {
    async verify(token) {
      if (!token.startsWith(FAKE_TOKEN_PREFIX)) return real.verify(token);
      try {
        const json: unknown = JSON.parse(
          Buffer.from(token.slice(FAKE_TOKEN_PREFIX.length), 'base64url').toString('utf8'),
        );
        const claims = fakeClaimsSchema.safeParse(json);
        if (!claims.success) return null;
        return {
          oid: claims.data.oid.toLowerCase(),
          email: claims.data.email.toLowerCase(),
          name: claims.data.name ?? null,
        };
      } catch {
        return null;
      }
    },
  };
}

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{10,8192})$/.exec(header ?? '');
  return match?.[1] ?? null;
}

export interface Coach {
  id: string;
  orgId: string;
  role: Role;
  status: CoachStatus;
  email: string;
  displayName: string | null;
}

const coachRowSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  role: roleSchema,
  status: coachStatusSchema,
  email: z.string(),
  display_name: z.string().nullable(),
});

export interface CoachLookup {
  find(oid: string): Promise<Coach | null>;
  /** Forgets cached coaches, after a change on this instance (invite accepted, coach removed). */
  forget(oid?: string): void;
}

/**
 * Resolves the coach for a verified identity, cached for about a minute per instance. A removed
 * coach is returned with status "removed" so that the caller can answer 403 forbidden.
 */
export class CoachDirectory implements CoachLookup {
  private readonly cache = new Map<string, { coach: Coach | null; until: number }>();

  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  async find(oid: string): Promise<Coach | null> {
    const hit = this.cache.get(oid);
    if (hit && hit.until > this.now()) return hit.coach;
    const rows = await this.db.withIdentity(oid, (db) =>
      db.query<unknown>(
        'SELECT id, org_id, role, status, email, display_name FROM stride.coaches WHERE entra_oid = @oid',
        {
          oid: [sql.UniqueIdentifier, oid],
        },
      ),
    );
    const row = rows[0] === undefined ? null : coachRowSchema.parse(rows[0]);
    const coach: Coach | null = row && {
      id: guid(row.id),
      orgId: guid(row.org_id),
      role: row.role,
      status: row.status,
      email: row.email,
      displayName: row.display_name,
    };
    if (coach?.status === 'active') {
      // Keeps last_seen_at roughly current: checked on a cache miss, written every five minutes at most.
      await this.db.withOrg(coach.orgId, (db) =>
        db.execute(
          'UPDATE stride.coaches SET last_seen_at = SYSUTCDATETIME() WHERE id = @id AND (last_seen_at IS NULL OR last_seen_at < DATEADD(minute, -5, SYSUTCDATETIME()))',
          { id: [sql.UniqueIdentifier, coach.id] },
        ),
      );
    }
    if (this.cache.size > 5_000) this.cache.clear();
    this.cache.set(oid, { coach, until: this.now() + COACH_CACHE_MS });
    return coach;
  }

  forget(oid?: string): void {
    if (oid === undefined) this.cache.clear();
    else this.cache.delete(oid);
  }
}
