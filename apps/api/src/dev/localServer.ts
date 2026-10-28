import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import functions, { type HttpResponseInit } from '@azure/functions';
import { z } from 'zod';

// A stand-in for Azure Functions Core Tools when `func` is not installed: serves the same route
// handlers over plain HTTP on port 7071 with the settings in local.settings.json. Timer
// functions do not run here. `pnpm dev` uses Core Tools whenever it is on the PATH.

const settingsSchema = z.object({ Values: z.record(z.string(), z.string()) });
const settingsFile = new URL('../../local.settings.json', import.meta.url);
for (const [key, value] of Object.entries(
  settingsSchema.parse(JSON.parse(readFileSync(settingsFile, 'utf8'))).Values,
)) {
  process.env[key] ??= value;
}

// A CommonJS package: Node's ESM loader cannot see its named exports.
const { HttpRequest, InvocationContext } = functions;

// Imported after the settings are in process.env.
const { registeredRoutes } = await import('../lib/http');
const { preflight } = await import('../functions/preflight');
await import('../functions/routes');

const routes = registeredRoutes().map((r) => ({
  ...r,
  pattern: new RegExp(`^/api${r.def.path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`),
}));

async function readAll(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const port = Number(process.env.STRIDE_API_PORT ?? 7071);
createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers))
      if (typeof value === 'string') headers[key] = value;
    headers['x-forwarded-for'] ??= req.socket.remoteAddress ?? '127.0.0.1';
    const body = await readAll(req);
    let response: HttpResponseInit;
    if (req.method === 'OPTIONS') {
      response = await preflight(new HttpRequest({ method: 'OPTIONS', url: url.href, headers }));
    } else {
      const match = routes.find((r) => r.def.method === req.method && r.pattern.test(url.pathname));
      if (!match) {
        response = {
          status: 404,
          body: '{"code":"not_found"}',
          headers: { 'Content-Type': 'application/problem+json' },
        };
      } else {
        const params = Object.fromEntries(
          Object.entries(match.pattern.exec(url.pathname)?.groups ?? {}).map(([k, v]) => [
            k,
            decodeURIComponent(v),
          ]),
        );
        const request = new HttpRequest({
          method: req.method ?? 'GET',
          url: url.href,
          headers,
          params,
          ...(body.length > 0 ? { body: { bytes: body } } : {}),
        });
        const context = new InvocationContext({
          invocationId: randomUUID(),
          functionName: match.name,
        });
        response = await match.handle(request, context);
      }
    }
    res.writeHead(response.status ?? 200, response.headers as Record<string, string>);
    const out = response.body;
    res.end(out instanceof Uint8Array || typeof out === 'string' ? out : undefined);
  })().catch((error: unknown) => {
    console.error(error);
    res.writeHead(500).end();
  });
}).listen(port, () => console.log(`Stride API (local server) on http://localhost:${port}/api`));
