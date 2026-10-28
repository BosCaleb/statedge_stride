import type { z } from 'zod';
import { ApiError } from './errors';

// Opaque keyset cursors: the sort key of the last item, as base64url JSON. Clients pass them
// back unchanged; a tampered cursor is a validation error, never a query fragment.

export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor<T extends z.ZodType>(
  cursor: string | undefined,
  schema: T,
): z.output<T> | null {
  if (cursor === undefined) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    // Falls through to the error below.
  }
  throw new ApiError('validation', 'The cursor is not valid', [
    { path: 'query.cursor', message: 'Invalid cursor' },
  ]);
}
