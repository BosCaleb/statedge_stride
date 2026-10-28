import type { ApiErrorCode } from '@stride/shared/enums';
import type { Problem } from '@stride/shared/api/common';
import type { z } from 'zod';

// RFC 9457 problem details with a stable code. Handlers throw ApiError for expected failures;
// anything else becomes a 500 with the request id and no internals.

const STATUS: Record<ApiErrorCode, number> = {
  unauthorised: 401,
  not_enrolled: 403,
  forbidden: 403,
  validation: 400,
  not_found: 404,
  conflict: 409,
  consent_required: 422,
  gate_failed: 422,
  seat_limit: 422,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
};

const TITLES: Record<ApiErrorCode, string> = {
  unauthorised: 'Sign-in required',
  not_enrolled: 'Not enrolled in an organisation',
  forbidden: 'Not allowed',
  validation: 'The request is not valid',
  not_found: 'Not found',
  conflict: 'Already written with different content',
  consent_required: 'Consent required',
  gate_failed: 'The result did not pass the quality gate',
  seat_limit: 'No free coach seats',
  payload_too_large: 'Too large',
  rate_limited: 'Too many requests',
  internal: 'Something went wrong',
};

export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;

  constructor(code: ApiErrorCode, detail?: string, errors?: FieldError[]) {
    super(detail ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.detail = detail;
    this.errors = errors;
  }
}

export function problemBody(error: ApiError, requestId: string): Problem {
  return {
    type: `urn:statedge:stride:problem:${error.code}`,
    title: TITLES[error.code],
    status: error.status,
    code: error.code,
    requestId,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(error.errors === undefined ? {} : { errors: error.errors }),
  };
}

/** A zod failure as a 400, with one entry per issue. Messages never echo the input. */
export function validationError(error: z.ZodError, prefix: string): ApiError {
  const errors = error.issues.slice(0, 50).map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter((p) => p.length > 0).join('.'),
    message: issue.message,
  }));
  return new ApiError('validation', 'The request failed validation', errors);
}

/** The uniform 404 that never says whether the resource exists in another organisation. */
export const notFound = () => new ApiError('not_found');
