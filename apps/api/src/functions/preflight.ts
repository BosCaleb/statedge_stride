import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { CORS_HEADERS, CORS_METHODS, corsHeaders } from '../lib/http';
import { services } from '../lib/services';

/**
 * Answers every CORS preflight (OPTIONS on any path). Only the origins in ALLOWED_ORIGINS get
 * the allow headers; for anything else the browser blocks the real request. No cookies.
 */
export function preflight(request: HttpRequest): Promise<HttpResponseInit> {
  const allowed = corsHeaders(request.headers.get('origin'), services().config.allowedOrigins);
  const headers: Record<string, string> = { ...allowed, 'Cache-Control': 'no-store' };
  if ('Access-Control-Allow-Origin' in allowed) {
    headers['Access-Control-Allow-Methods'] = CORS_METHODS;
    headers['Access-Control-Allow-Headers'] = CORS_HEADERS;
    headers['Access-Control-Max-Age'] = '600';
  }
  return Promise.resolve({ status: 204, headers });
}
