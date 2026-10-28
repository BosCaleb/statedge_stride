// pnpm dev: the web app on http://localhost:5173 and the API on http://localhost:7071/api.
// With Azure Functions Core Tools (`func`) on the PATH it runs the real Functions host, an
// esbuild watch and Azurite; otherwise it serves the same handlers with a small Node server
// (apps/api/src/dev/localServer.ts), which runs everything except timer functions.
// SQL Server comes from `pnpm db:up`, then `pnpm db:migrate` and `pnpm seed`.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const api = `${root}apps/api`;
const settings = `${api}/local.settings.json`;
if (!existsSync(settings)) {
  copyFileSync(`${api}/local.settings.example.json`, settings);
  console.log('created apps/api/local.settings.json from the example');
}

const children: ChildProcess[] = [];
function run(
  name: string,
  command: string,
  args: string[],
  cwd = root,
  env: NodeJS.ProcessEnv = {},
): void {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `[${name}] `;
  const relay = (stream: NodeJS.WritableStream) => (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n'))
      if (line.trim()) stream.write(prefix + line + '\n');
  };
  child.stdout.on('data', relay(process.stdout));
  child.stderr.on('data', relay(process.stderr));
  child.on('exit', (code) => {
    console.log(`${prefix}exited with ${code ?? 'a signal'}`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

function shutdown(code: number): never {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const hasFunc = spawnSync('func', ['--version'], { stdio: 'ignore' }).status === 0;
if (hasFunc) {
  run(
    'azurite',
    'pnpm',
    ['exec', 'azurite', '--silent', '--location', `${root}.azurite`, '--skipApiVersionCheck'],
    api,
  );
  run('api-build', 'pnpm', ['exec', 'tsx', 'scripts/build.ts', '--watch'], api);
  run('api', 'func', ['start', '--port', '7071'], api);
} else {
  console.log(
    'Azure Functions Core Tools not found: serving the API with the local Node server instead.',
  );
  run('api', 'pnpm', ['exec', 'tsx', 'watch', 'src/dev/localServer.ts'], api);
}
run('web', 'pnpm', ['exec', 'vite', '--port', '5173', '--strictPort'], `${root}apps/web`);
