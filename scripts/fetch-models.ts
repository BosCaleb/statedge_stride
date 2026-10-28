// Downloads the pinned pose models and copies the MediaPipe WASM runtime into
// apps/web/public/models, so that the app self-hosts every model file. Versions and SHA-256
// checksums are pinned in apps/web/src/analysis-runtime/models.json; a mismatch fails the script.
//
//   pnpm fetch-models            the default model (full) and the WASM runtime
//   pnpm fetch-models --heavy    also the heavy model

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ModelEntry {
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}

interface Manifest {
  tasksVisionVersion: string;
  wasmDir: string;
  models: Record<string, ModelEntry>;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(root, 'apps/web');
const outDir = join(webDir, 'public/models');
const manifest = JSON.parse(
  await readFile(join(webDir, 'src/analysis-runtime/models.json'), 'utf8'),
) as Manifest;

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

async function existingHash(path: string): Promise<string | null> {
  try {
    return sha256(await readFile(path));
  } catch {
    return null;
  }
}

async function fetchModel(name: string, entry: ModelEntry): Promise<void> {
  const dest = join(outDir, entry.file);
  if ((await existingHash(dest)) === entry.sha256) {
    console.log(`model ${name}: up to date (${entry.file})`);
    return;
  }
  console.log(`model ${name}: downloading ${entry.url}`);
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`model ${name}: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const hash = sha256(data);
  if (hash !== entry.sha256) {
    throw new Error(`model ${name}: checksum mismatch, expected ${entry.sha256}, got ${hash}`);
  }
  await writeFile(dest, data);
  console.log(`model ${name}: ${data.byteLength} bytes, checksum verified`);
}

async function copyWasm(): Promise<void> {
  const require = createRequire(join(webDir, 'package.json'));
  // The package's exports map does not expose package.json, so resolve the entry point.
  const pkgDir = dirname(require.resolve('@mediapipe/tasks-vision'));
  const pkgPath = join(pkgDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version: string };
  if (pkg.version !== manifest.tasksVisionVersion) {
    throw new Error(
      `@mediapipe/tasks-vision is ${pkg.version} but models.json pins ${manifest.tasksVisionVersion}; update both together`,
    );
  }
  const from = join(dirname(pkgPath), 'wasm');
  const to = join(outDir, manifest.wasmDir);
  await mkdir(to, { recursive: true });
  for (const file of await readdir(from)) await copyFile(join(from, file), join(to, file));
  console.log(`wasm: copied @mediapipe/tasks-vision ${pkg.version} runtime to ${manifest.wasmDir}`);
}

await mkdir(outDir, { recursive: true });
await copyWasm();
const wanted = process.argv.includes('--heavy') ? ['full', 'heavy'] : ['full'];
for (const name of wanted) {
  const entry = manifest.models[name];
  if (!entry) throw new Error(`unknown model ${name}`);
  await fetchModel(name, entry);
}
