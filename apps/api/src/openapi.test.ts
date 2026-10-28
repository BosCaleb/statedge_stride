import { readFileSync } from 'node:fs';
import { buildOpenApiDocument } from '@stride/shared/api/openapi';
import { describe, expect, it } from 'vitest';
import { registeredRoutes } from './lib/http';
import './functions/routes';

describe('API contract', () => {
  it('matches the committed openapi.json (run `pnpm openapi` after changing a schema)', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });

  it('binds only routes that the registry defines, each once', () => {
    const names = registeredRoutes().map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
