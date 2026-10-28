import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildOpenApiDocument } from './openapi';
import { isBinary, ROUTES, type RouteDef } from './routes';

const routes = Object.entries(ROUTES) as [string, RouteDef][];

describe('route registry', () => {
  it('has one handler per method and path', () => {
    const keys = routes.map(([, r]) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('declares a schema for exactly the parameters in each path', () => {
    for (const [name, r] of routes) {
      const inPath = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const declared = Object.keys(r.params?.shape ?? {}).sort();
      expect(declared, name).toEqual(inPath);
    }
  });

  it('creates only with PUT or POST, and returns a body for every create', () => {
    for (const [name, r] of routes.filter(([, r]) => r.creates)) {
      expect(['PUT', 'POST'], name).toContain(r.method);
      expect(r.response, name).not.toBeNull();
    }
    // Every PUT with a client-generated id is an idempotent create or a plain update.
    for (const [name, r] of routes.filter(([, r]) => r.method === 'PUT')) {
      expect(r.creates, name).toBe('once');
    }
  });

  it('keeps bodies off GET and leaves public routes free of personal input', () => {
    for (const [name, r] of routes) {
      if (r.method === 'GET') expect(r.body, name).toBeUndefined();
      if (r.auth === 'none') expect(r.method, name).toBe('GET');
    }
  });

  it('caps every binary upload', () => {
    for (const [, r] of routes) {
      if (isBinary(r.body)) expect(r.body.maxBytes).toBeGreaterThan(0);
    }
  });

  it('coerces query strings and rejects an over-limit page size', () => {
    const query = ROUTES.listAthletes.query;
    expect(query.parse({ limit: '10', q: ' Ay ' })).toEqual({ limit: 10, q: 'Ay' });
    expect(query.parse({})).toEqual({ limit: 25 });
    expect(query.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('applies the share expiry default and maximum', () => {
    const body = ROUTES.createShare.body;
    expect(body.parse({})).toEqual({ expiresInDays: 30 });
    expect(body.safeParse({ expiresInDays: 91 }).success).toBe(false);
  });

  it('accepts only base64url tokens of 32 bytes in public paths', () => {
    const params = ROUTES.publicReport.params;
    expect(params.safeParse({ token: 'a'.repeat(43) }).success).toBe(true);
    expect(params.safeParse({ token: `${'a'.repeat(42)}=` }).success).toBe(false);
    expect(params.safeParse({ token: '../../etc/passwd' }).success).toBe(false);
  });
});

describe('OpenAPI document', () => {
  it('describes every route with its operation id', () => {
    const doc = buildOpenApiDocument();
    const ops = Object.values(doc.paths).flatMap((p) =>
      Object.values(p).map((o) => (o as { operationId: string }).operationId),
    );
    expect(ops.sort()).toEqual(routes.map(([name]) => name).sort());
    expect(z.string().parse(doc.openapi)).toBe('3.1.0');
  });
});
