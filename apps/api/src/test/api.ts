import { randomUUID } from 'node:crypto';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { ROUTES, type RouteName } from '@stride/shared/api/routes';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { entraVerifier } from '../lib/auth';
import { loadConfig, type ApiConfig } from '../lib/config';
import { handlerFor } from '../lib/http';

// Drives the real request pipeline without the Functions host: builds an HttpRequest for a
// route of the registry, runs the bound handler, and captures the log lines.

export const TEST_TENANT = '11111111-2222-4333-8444-555555555555';
export const TEST_AUDIENCE = '99999999-8888-4777-8666-555555555555';
export const TEST_ORIGIN = 'http://localhost:5173';

export function testConfig(env: Record<string, string> = {}): ApiConfig {
  return loadConfig({
    ENVIRONMENT: 'local',
    SQL_SERVER: 'localhost',
    SQL_DATABASE: 'stride_test',
    SQL_AUTH: 'sql',
    ENTRA_TENANT_ID: TEST_TENANT,
    ENTRA_API_AUDIENCE: TEST_AUDIENCE,
    ALLOWED_ORIGINS: TEST_ORIGIN,
    BUILD_VERSION: 'test-build',
    ...env,
  });
}

/** A signing key and the matching key set, standing in for the tenant's JWKS endpoint. */
export async function testSigner(config: ApiConfig) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (
    claims: JWTPayload,
    options: { expiresIn?: string; issuer?: string; audience?: string } = {},
  ) =>
    new SignJWT({ scp: 'access_as_user', ver: '2.0', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })
      .setIssuer(options.issuer ?? config.entra.issuer)
      .setAudience(options.audience ?? config.entra.audience)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '10m')
      .sign(privateKey);
  return { keys, verifier: entraVerifier(config.entra, keys), sign };
}

export interface CallInit {
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** A JSON value, raw bytes, or a raw string sent as is. */
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

export interface CallResult {
  status: number;
  headers: Record<string, string>;
  text: string;
  bytes: Uint8Array;
  json: unknown;
  logs: string[];
}

export async function callRoute(name: RouteName, init: CallInit = {}): Promise<CallResult> {
  const def = ROUTES[name];
  const params = init.params ?? {};
  const path = def.path.replace(/\{(\w+)\}/g, (_m, key: string) =>
    encodeURIComponent(params[key] ?? ''),
  );
  const search = new URLSearchParams(init.query ?? {}).toString();
  const headers: Record<string, string> = {
    origin: TEST_ORIGIN,
    'x-forwarded-for': '203.0.113.7:50000',
    ...init.headers,
  };
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  let body: { bytes?: Uint8Array; string?: string } | undefined;
  if (init.body instanceof Uint8Array) body = { bytes: init.body };
  else if (typeof init.body === 'string') body = { string: init.body };
  else if (init.body !== undefined) body = { string: JSON.stringify(init.body) };
  if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['content-type'] =
      init.body instanceof Uint8Array ? 'application/octet-stream' : 'application/json';
  }
  const request = new HttpRequest({
    method: def.method,
    url: `http://localhost:7071/api${path}${search ? `?${search}` : ''}`,
    headers,
    params,
    ...(body ? { body } : {}),
  });
  const logs: string[] = [];
  const context = new InvocationContext({
    invocationId: randomUUID(),
    functionName: name,
    logHandler: (_level, ...args) => logs.push(args.map(String).join(' ')),
  });
  const response = await handlerFor(name)(request, context);
  const raw = response.body;
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : typeof raw === 'string'
        ? new TextEncoder().encode(raw)
        : new Uint8Array(0);
  const text = new TextDecoder().decode(bytes);
  const responseHeaders = Object.fromEntries(
    Object.entries((response.headers ?? {}) as Record<string, string>).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ]),
  );
  const isJson = /json/.test(responseHeaders['content-type'] ?? '');
  return {
    status: response.status ?? 200,
    headers: responseHeaders,
    text,
    bytes,
    json: isJson && text ? (JSON.parse(text) as unknown) : undefined,
    logs,
  };
}
