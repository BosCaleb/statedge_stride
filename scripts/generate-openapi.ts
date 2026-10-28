// pnpm openapi: writes apps/api/openapi.json from the route registry in packages/shared. A
// contract test (apps/api/src/openapi.test.ts) fails while the committed copy is out of date.
import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from '@stride/shared/api/openapi';

const file = new URL('../apps/api/openapi.json', import.meta.url);
writeFileSync(file, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`wrote ${file.pathname}`);
