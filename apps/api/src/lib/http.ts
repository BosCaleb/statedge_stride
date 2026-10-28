import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { isBinary, ROUTES, type RouteDef, type RouteName } from '@stride/shared/api/routes';
import { LIMITS } from '@stride/shared/limits';
import type { z } from 'zod';
import { bearerToken, type Coach, type Identity } from './auth';
import type { Db } from './db';
import { ApiError, problemBody, validationError } from './errors';
import { services, type Services } from './services';

// The one request pipeline every route goes through, in this order: public rate limit, token,
// coach and role, per-coach rate limit, path and query parameters, body (type, size, schema),
// handler, response schema. Errors become problem+json. One structured log line per request,
// with ids only: never bodies, names, tokens or query strings.

type Def<N extends RouteName> = (typeof ROUTES)[N];

type ParamsOf<R> = R extends { params: infer P extends z.ZodType }
  ? z.output<P>
  : Record<string, never>;
type QueryOf<R> = R extends { query: infer Q extends z.ZodType }
  ? z.output<Q>
  : Record<string, never>;
type BodyOf<R> = R extends { body: infer B }
  ? B extends z.ZodType
    ? z.output<B>
    : Uint8Array
  : undefined;
type ResponseOf<R> = R extends { response: infer S }
  ? S extends z.ZodType
    ? z.input<S>
    : S extends null
      ? undefined
      : Uint8Array
  : never;

export interface Call<R> {
  params: ParamsOf<R>;
  query: QueryOf<R>;
  body: BodyOf<R>;
  /** The verified token's identity. Null on public routes. */
  identity: R extends { auth: 'none' } ? null : Identity;
  /** The enrolled, active coach. Null on public and token-only routes. */
  coach: R extends { auth: 'coach' | 'admin' } ? Coach : null;
  /** Runs fn in a transaction scoped to the coach's organisation by row-level security. */
  withOrg: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  request: HttpRequest;
  requestId: string;
  services: Services;
}

export type Reply<R> =
  ResponseOf<R> extends undefined ? void : { created?: boolean; body: ResponseOf<R> };
export type Handler<R> = (call: Call<R>) => Promise<Reply<R>>;

export type HttpFunction = (
  request: HttpRequest,
  context: InvocationContext,
) => Promise<HttpResponseInit>;

interface Registered {
  name: RouteName;
  def: RouteDef;
  handle: HttpFunction;
}

const registry = new Map<RouteName, Registered>();

/** Binds a handler to a route of the registry. index.ts registers them all with the host. */
export function route<N extends RouteName>(name: N, handler: Handler<Def<N>>): void {
  const def: RouteDef = ROUTES[name];
  registry.set(name, {
    name,
    def,
    handle: (request, context) =>
      run(name, def, handler as unknown as LooseHandler, request, context),
  });
}

export function registeredRoutes(): Registered[] {
  return [...registry.values()];
}

/** The handler bound to a route, for tests. */
export function handlerFor(name: RouteName): HttpFunction {
  const r = registry.get(name);
  if (!r) throw new Error(`No handler is registered for ${name}`);
  return r.handle;
}

type LooseHandler = (
  call: Record<string, unknown>,
) => Promise<{ created?: boolean; body: unknown } | undefined>;

class RateLimited extends ApiError {
  constructor(readonly retryAfter: number) {
    super('rate_limited');
  }
}

interface LogFields {
  event: 'request';
  requestId: string;
  route: string;
  method: string;
  status?: number;
  durationMs?: number;
  orgId?: string;
  coachId?: string;
  code?: string;
}

async function run(
  name: string,
  def: RouteDef,
  handler: LooseHandler,
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const started = Date.now();
  const requestId = context.invocationId;
  const log: LogFields = { event: 'request', requestId, route: name, method: def.method };
  let response: HttpResponseInit;
  let cors: Record<string, string> = { Vary: 'Origin' };
  try {
    const s = services();
    cors = corsHeaders(request.headers.get('origin'), s.config.allowedOrigins);
    if (def.auth === 'none') limit(s, 'public', `ip:${clientIp(request)}`);
    const identity = def.auth === 'none' ? null : await authenticate(request, s);
    let coach: Coach | null = null;
    if (identity) {
      limit(s, 'coach', `oid:${identity.oid}`);
      if (def.auth === 'coach' || def.auth === 'admin') {
        coach = await enrolledCoach(identity, def.auth, s);
        log.orgId = coach.orgId;
        log.coachId = coach.id;
      }
    }
    const params = parseWith(def.params, request.params, 'params');
    const query = parseWith(def.query, Object.fromEntries(request.query.entries()), 'query');
    const body = await readBody(def, request);
    const orgId = coach?.orgId;
    const reply = await handler({
      params,
      query,
      body,
      identity,
      coach,
      withOrg: <T>(fn: (db: Db) => Promise<T>) => {
        if (orgId === undefined) throw new Error('withOrg is available on coach routes only');
        return s.db.withOrg(orgId, fn);
      },
      request,
      requestId,
      services: s,
    });
    response = success(def, reply);
  } catch (error) {
    response = failure(error, requestId, context, log);
  }
  response.headers = {
    ...securityHeaders(def, response.status ?? 200),
    ...cors,
    ...(response.headers as Record<string, string>),
  };
  log.status = response.status ?? 200;
  log.durationMs = Date.now() - started;
  context.info(JSON.stringify(log));
  return response;
}

function limit(s: Services, which: 'public' | 'coach', key: string): void {
  const wait = (which === 'public' ? s.publicLimit : s.coachLimit).take(key);
  if (wait > 0) throw new RateLimited(wait);
}

async function authenticate(request: HttpRequest, s: Services): Promise<Identity> {
  const token = bearerToken(request.headers.get('authorization'));
  const identity = token === null ? null : await s.verifier.verify(token);
  if (!identity) throw new ApiError('unauthorised');
  return identity;
}

async function enrolledCoach(
  identity: Identity,
  level: 'coach' | 'admin',
  s: Services,
): Promise<Coach> {
  const coach = await s.coaches.find(identity.oid);
  if (!coach) throw new ApiError('not_enrolled');
  if (coach.status !== 'active')
    throw new ApiError('forbidden', 'This account was removed from its organisation');
  if (level === 'admin' && coach.role !== 'admin')
    throw new ApiError('forbidden', 'Only an administrator can do this');
  return coach;
}

function parseWith(schema: z.ZodType | undefined, value: unknown, prefix: string): unknown {
  if (!schema) return {};
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error, prefix);
  return parsed.data;
}

async function readBody(def: RouteDef, request: HttpRequest): Promise<unknown> {
  if (!def.body) return undefined;
  const binary = isBinary(def.body) ? def.body : null;
  const expected = binary ? binary.contentType : 'application/json';
  const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== expected) throw new ApiError('validation', `Content-Type must be ${expected}`);
  const bytes = await readLimited(request, binary ? binary.maxBytes : LIMITS.jsonBodyBytes);
  if (binary) return bytes;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError('validation', 'The body is not valid JSON');
  }
  return parseWith(def.body as z.ZodType, json, 'body');
}

/** Reads the body, refusing it as soon as it passes maxBytes, whatever Content-Length said. */
export async function readLimited(request: HttpRequest, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError('payload_too_large');
  const stream = request.body as ReadableStream<Uint8Array> | null;
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError('payload_too_large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function success(
  def: RouteDef,
  reply: { created?: boolean; body: unknown } | undefined,
): HttpResponseInit {
  const response = def.response;
  if (response === null) return { status: 204 };
  if (!reply) throw new Error('The handler returned no reply');
  const status = def.creates === 'always' || (def.creates === 'once' && reply.created) ? 201 : 200;
  if (isBinary(response)) {
    if (!(reply.body instanceof Uint8Array))
      throw new Error('A binary route must reply with bytes');
    return { status, body: reply.body, headers: { 'Content-Type': response.contentType } };
  }
  const parsed = response.safeParse(reply.body);
  if (!parsed.success) {
    // A bug, never the client's fault. The paths say where; values are not logged.
    const paths = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`The response failed its schema at ${paths}`);
  }
  return {
    status,
    body: JSON.stringify(parsed.data),
    headers: { 'Content-Type': 'application/json' },
  };
}

function failure(
  error: unknown,
  requestId: string,
  context: InvocationContext,
  log: LogFields,
): HttpResponseInit {
  const known = error instanceof ApiError ? error : null;
  if (!known) {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
        : String(error);
    context.error(JSON.stringify({ ...log, event: 'error', error: message }));
  }
  const problem = known ?? new ApiError('internal');
  log.code = problem.code;
  const headers: Record<string, string> = {
    'Content-Type': 'application/problem+json',
    'Cache-Control': 'no-store',
  };
  if (problem.code === 'unauthorised') headers['WWW-Authenticate'] = 'Bearer';
  if (problem instanceof RateLimited) headers['Retry-After'] = String(problem.retryAfter);
  return { status: problem.status, body: JSON.stringify(problemBody(problem, requestId)), headers };
}

function securityHeaders(def: RouteDef, status: number): Record<string, string> {
  const cacheable = def.maxAgeSeconds !== undefined && status === 200;
  return {
    'Cache-Control': cacheable ? `public, max-age=${def.maxAgeSeconds}` : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
    ...(def.path.startsWith('/v1/public/') ? { 'X-Robots-Tag': 'noindex' } : {}),
  };
}

export const CORS_METHODS = 'GET, PUT, POST, PATCH, DELETE';
export const CORS_HEADERS = 'Authorization, Content-Type';

export function corsHeaders(
  origin: string | null,
  allowed: readonly string[],
): Record<string, string> {
  if (origin === null || !allowed.includes(origin)) return { Vary: 'Origin' };
  return {
    Vary: 'Origin',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'Retry-After',
  };
}

/** The client address from the front end's X-Forwarded-For, without the port. */
export function clientIp(request: HttpRequest): string {
  const first = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  if (first.startsWith('[')) return first.slice(1, first.indexOf(']'));
  const parts = first.split(':');
  return (parts.length === 2 ? parts[0] : first) || 'unknown';
}
