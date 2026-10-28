import { problemSchema, type Problem } from '@stride/shared/api/common';
import { isBinary, ROUTES, type RouteName } from '@stride/shared/api/routes';
import type { ApiErrorCode } from '@stride/shared/enums';
import type { z } from 'zod';

// A small typed wrapper over fetch, derived from the shared route registry: the same zod schemas
// check what is sent and what comes back. No cookies are ever sent.

type Def<N extends RouteName> = (typeof ROUTES)[N];
type ParamsOf<D> = D extends { params: infer P extends z.ZodType } ? z.input<P> : undefined;
type QueryOf<D> = D extends { query: infer Q extends z.ZodType } ? Partial<z.input<Q>> : undefined;
type BodyOf<D> = D extends { body: infer B }
  ? B extends z.ZodType
    ? z.input<B>
    : Blob
  : undefined;
export type ResponseOf<D> = D extends { response: infer S }
  ? S extends z.ZodType
    ? z.output<S>
    : S extends null
      ? null
      : Blob
  : never;

export type CallInput<N extends RouteName> = {
  signal?: AbortSignal;
} & (ParamsOf<Def<N>> extends undefined ? { params?: undefined } : { params: ParamsOf<Def<N>> }) &
  (QueryOf<Def<N>> extends undefined ? { query?: undefined } : { query?: QueryOf<Def<N>> }) &
  (BodyOf<Def<N>> extends undefined ? { body?: undefined } : { body: BodyOf<Def<N>> });

export interface CallResult<N extends RouteName> {
  status: number;
  data: ResponseOf<Def<N>>;
}

/** A problem+json answer from the API, or one made up locally for a missing token. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiProblem';
    this.status = problem.status;
    this.code = problem.code;
    this.problem = problem;
  }
}

/** The request never reached the API, or the answer was cut off. Safe to retry. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The network request failed', { cause });
    this.name = 'NetworkError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** A bearer token, or null when the coach must sign in again. */
  getToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export type ApiCall = <N extends RouteName>(name: N, input: CallInput<N>) => Promise<CallResult<N>>;

export function createApiClient(options: ApiClientOptions): ApiCall {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  return async function call<N extends RouteName>(
    name: N,
    input: CallInput<N>,
  ): Promise<CallResult<N>> {
    const def = ROUTES[name];
    const params = (input.params ?? {}) as Record<string, string | number>;
    const path = def.path.replace(/\{(\w+)\}/g, (_m, key: string) => {
      const value = params[key];
      if (value === undefined) throw new Error(`Missing path parameter ${key} for ${name}`);
      return encodeURIComponent(String(value));
    });
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries((input.query ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        search.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (def.auth !== 'none') {
      const token = await options.getToken();
      if (!token) throw localProblem(401, 'unauthorised', 'Sign in again to continue');
      headers.Authorization = `Bearer ${token}`;
    }
    let body: BodyInit | undefined;
    if ('body' in def && input.body !== undefined) {
      if (isBinary(def.body)) {
        headers['Content-Type'] = def.body.contentType;
        body = input.body as Blob;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify((def.body as z.ZodType).parse(input.body));
      }
    }
    const url = `${options.baseUrl}${path}${search.size > 0 ? `?${search.toString()}` : ''}`;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: def.method,
        headers,
        body,
        credentials: 'omit',
        cache: 'no-store',
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new NetworkError(error);
    }
    if (!response.ok) throw await problemFrom(response);
    const reply = def.response;
    if (reply === null || response.status === 204)
      return { status: response.status, data: null as ResponseOf<Def<N>> };
    if (isBinary(reply))
      return { status: response.status, data: (await response.blob()) as ResponseOf<Def<N>> };
    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new NetworkError(error);
    }
    return {
      status: response.status,
      data: (reply as z.ZodType).parse(json) as ResponseOf<Def<N>>,
    };
  };
}

function localProblem(status: number, code: ApiErrorCode, detail: string): ApiProblem {
  return new ApiProblem({ type: 'about:blank', title: detail, status, code, detail });
}

async function problemFrom(response: Response): Promise<ApiProblem | NetworkError> {
  try {
    const parsed = problemSchema.safeParse(await response.json());
    if (parsed.success) return new ApiProblem(parsed.data);
  } catch {
    // Not JSON: a proxy or the platform answered. Treat 5xx as transient.
  }
  if (response.status >= 500 || response.status === 0)
    return new NetworkError(new Error(`HTTP ${response.status}`));
  return localProblem(
    response.status,
    response.status === 401 ? 'unauthorised' : 'internal',
    `HTTP ${response.status}`,
  );
}

/** Errors that never succeed on retry: the outbox marks the entry failed and asks the coach. */
export const PERMANENT_CODES: readonly ApiErrorCode[] = [
  'validation',
  'consent_required',
  'gate_failed',
  'conflict',
  'forbidden',
  'not_enrolled',
  'not_found',
  'seat_limit',
  'payload_too_large',
];
