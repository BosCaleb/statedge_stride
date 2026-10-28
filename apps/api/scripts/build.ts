// Builds the API for Azure Functions with esbuild: one ES module bundle per entry point, so the
// deployed package needs no node_modules and the workspace packages (TypeScript sources) are
// compiled in.
//
//   pnpm --filter @stride/api build           .deploy/app (the Function App package) and
//                                             .deploy/migrate (migrate.mjs and the .sql files)
//   pnpm --filter @stride/api build --watch   dist/index.js for `func start` during development

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, context, type BuildOptions } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const watch = process.argv.includes('--watch');

const common: BuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  legalComments: 'linked',
  // Bundled CommonJS dependencies (mssql, tedious) call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __stride_require } from 'node:module'; const require = __stride_require(import.meta.url);",
  },
  // Provided by the Functions worker at run time.
  external: ['@azure/functions-core'],
  logLevel: 'info',
};

if (watch) {
  const ctx = await context({
    ...common,
    entryPoints: [`${root}src/index.ts`],
    outfile: `${root}dist/index.js`,
  });
  await ctx.watch();
} else {
  const out = `${root}.deploy`;
  await rm(out, { recursive: true, force: true });
  // Minified for a faster cold start; the linked source map keeps stack traces readable.
  await build({
    ...common,
    minify: true,
    entryPoints: [`${root}src/index.ts`],
    outfile: `${out}/app/dist/index.js`,
  });
  await cp(`${root}host.json`, `${out}/app/host.json`);
  await writeFile(
    `${out}/app/package.json`,
    `${JSON.stringify({ name: 'stride-api', private: true, type: 'module', main: 'dist/index.js' }, null, 2)}\n`,
  );
  await mkdir(`${out}/migrate`, { recursive: true });
  await build({
    ...common,
    entryPoints: [`${root}src/migrateMain.ts`],
    outfile: `${out}/migrate/migrate.mjs`,
  });
  await cp(`${root}migrations`, `${out}/migrate/migrations`, { recursive: true });
}
