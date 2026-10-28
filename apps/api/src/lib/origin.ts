import type { HttpRequest } from '@azure/functions';
import type { ApiConfig } from './config';

/**
 * The web origin for links the API hands out (invites, shares): the calling page's origin when
 * it is an allowed one, otherwise the first allowed origin. Never an arbitrary header value.
 */
export function webOrigin(request: HttpRequest, config: ApiConfig): string {
  const origin = request.headers.get('origin');
  if (origin !== null && config.allowedOrigins.includes(origin)) return origin;
  const first = config.allowedOrigins[0];
  if (first === undefined) throw new Error('ALLOWED_ORIGINS is empty');
  return first;
}
