// Serves a built dist/ folder the way Azure Static Web Apps will: the headers and routes from
// dist/staticwebapp.config.json, the navigation fallback to index.html, and the MIME types.
// End-to-end tests run against this, so a content security policy violation fails a test.
//
//   pnpm --filter @stride/web preview [dist] [--port 4173]

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const { values, positionals } = parseArgs({
  options: { port: { type: 'string', default: '4173' } },
  allowPositionals: true,
});
const root = resolve(positionals[0] ?? 'dist');
const port = Number(values.port);

const configSchema = z.object({
  globalHeaders: z.record(z.string(), z.string()),
  routes: z.array(z.object({ route: z.string(), headers: z.record(z.string(), z.string()) })),
  navigationFallback: z.object({ rewrite: z.string(), exclude: z.array(z.string()) }),
  mimeTypes: z.record(z.string(), z.string()),
});
const config = configSchema.parse(
  JSON.parse(await readFile(join(root, 'staticwebapp.config.json'), 'utf8')),
);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.mp4': 'video/mp4',
  ...config.mimeTypes,
};

/** SWA wildcards: `*` matches anything; `{a,b}` matches one of the alternatives. */
function matches(pattern: string, path: string): boolean {
  const source = pattern
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .replace(/\{([^}]+)\}/g, (_m, alts: string) => `(${alts.split(',').join('|')})`)
    .replace(/\*/g, '.*');
  return new RegExp(`^${source}$`).test(path);
}

async function file(path: string): Promise<string | null> {
  const full = normalize(join(root, path));
  if (!full.startsWith(root)) return null;
  try {
    return (await stat(full)).isFile() ? full : null;
  } catch {
    return null;
  }
}

createServer((req, res) => {
  void (async () => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let target = await file(path === '/' ? '/index.html' : path);
    if (!target && !config.navigationFallback.exclude.some((p) => matches(p, path))) {
      target = await file(config.navigationFallback.rewrite);
    }
    const headers: Record<string, string> = { ...config.globalHeaders };
    // Served over plain http on localhost, so the https upgrade would break every request.
    const csp = headers['Content-Security-Policy'];
    if (csp) headers['Content-Security-Policy'] = csp.replace(/;\s*upgrade-insecure-requests/, '');
    for (const r of config.routes) if (matches(r.route, path)) Object.assign(headers, r.headers);
    if (!target) {
      res.writeHead(404, headers).end('Not found');
      return;
    }
    headers['Content-Type'] = TYPES[extname(target)] ?? 'application/octet-stream';
    res.writeHead(200, headers).end(await readFile(target));
  })().catch(() => res.writeHead(500).end());
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
