import { z } from 'zod';
import type { DbSettings } from './db';

// API settings, read once from the environment (Function App settings in Azure,
// local.settings.json under Core Tools). None of them is a secret.

const flag = z.enum(['true', 'false']).transform((v) => v === 'true');
const origin = z
  .url()
  .refine((u) => new URL(u).origin === u, 'An origin has no path or trailing slash');

const envSchema = z.object({
  ENVIRONMENT: z.enum(['local', 'dev', 'prod']),
  BUILD_VERSION: z.string().min(1).default('dev'),
  SQL_SERVER: z.string().min(1),
  SQL_DATABASE: z.string().min(1),
  SQL_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
  /** "sql" (a SQL login) exists for SQL Server in Docker and is refused outside local. */
  SQL_AUTH: z.enum(['entra', 'sql']).default('entra'),
  SQL_USER: z.string().optional(),
  SQL_PASSWORD: z.string().optional(),
  ENTRA_TENANT_ID: z.guid(),
  /** The API app registration's client id: the `aud` of a version 2 access token. */
  ENTRA_API_AUDIENCE: z.string().min(1),
  /** Overrides for the issuer and key set, which are otherwise derived from the tenant id. */
  ENTRA_ISSUER: z.url().optional(),
  ENTRA_JWKS_URI: z.url().optional(),
  ALLOWED_ORIGINS: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    )
    .pipe(z.array(origin).min(1)),
  /** Signs in as a seeded coach without Entra. Honoured only when ENVIRONMENT is local. */
  DEV_FAKE_AUTH: flag.default(false),
  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
});

export interface ApiConfig {
  environment: 'local' | 'dev' | 'prod';
  buildVersion: string;
  db: DbSettings;
  entra: { tenantId: string; audience: string; issuer: string; jwksUri: string; scope: string };
  allowedOrigins: readonly string[];
  fakeAuth: boolean;
  appInsightsConnectionString: string | undefined;
}

/** Best-effort, per-instance rate limits (requests per minute). */
export const RATE_LIMITS = {
  perCoach: 120,
  perIpOnPublicRoutes: 60,
} as const;

/** How long a resolved coach is cached per instance, in milliseconds. */
export const COACH_CACHE_MS = 60_000;

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Names only: the values are not secrets, but they are not needed in a log either.
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid API settings: ${names}`);
  }
  const e = parsed.data;
  const local = e.ENVIRONMENT === 'local';
  if (e.SQL_AUTH === 'sql' && !local)
    throw new Error('SQL_AUTH=sql is allowed only when ENVIRONMENT=local');
  const tenant = e.ENTRA_TENANT_ID;
  return {
    environment: e.ENVIRONMENT,
    buildVersion: e.BUILD_VERSION,
    db: {
      server: e.SQL_SERVER,
      database: e.SQL_DATABASE,
      port: e.SQL_PORT,
      auth: e.SQL_AUTH,
      ...(e.SQL_USER === undefined ? {} : { user: e.SQL_USER }),
      ...(e.SQL_PASSWORD === undefined ? {} : { password: e.SQL_PASSWORD }),
      trustServerCertificate: local,
    },
    entra: {
      tenantId: tenant,
      audience: e.ENTRA_API_AUDIENCE,
      issuer: e.ENTRA_ISSUER ?? `https://${tenant}.ciamlogin.com/${tenant}/v2.0`,
      jwksUri: e.ENTRA_JWKS_URI ?? `https://${tenant}.ciamlogin.com/${tenant}/discovery/v2.0/keys`,
      scope: 'access_as_user',
    },
    allowedOrigins: e.ALLOWED_ORIGINS,
    fakeAuth: local && e.DEV_FAKE_AUTH,
    appInsightsConnectionString: e.APPLICATIONINSIGHTS_CONNECTION_STRING,
  };
}
