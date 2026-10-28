// pnpm licences: lists the licences of every dependency and fails when a production dependency
// is not under MIT, Apache-2.0, BSD or ISC terms, or when any dependency at all (development
// tools included) is under GPL, LGPL or AGPL terms.

import { execFileSync } from 'node:child_process';
import { z } from 'zod';

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'ISC']);

/** Reviewed production dependencies whose licence expression is outside the allowlist. */
const EXCEPTIONS: Record<string, string> = {
  pako: 'MIT AND Zlib. Approved by StatEdge on 2026-10-28 (docs/decisions.md, D51). Used by jspdf.',
};

const COPYLEFT = /\b(A|L)?GPL\b/i;

const listing = z.record(
  z.string(),
  z.array(z.object({ name: z.string(), versions: z.array(z.string()), license: z.string() })),
);

function licences(prodOnly: boolean) {
  const args = ['licenses', 'list', '--json', '--recursive', ...(prodOnly ? ['--prod'] : [])];
  const out = execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return listing.parse(JSON.parse(out));
}

/** True when some alternative of an SPDX expression uses allowed licences only. */
function acceptable(expression: string): boolean {
  const bare = expression.replace(/[()]/g, ' ').trim();
  return bare
    .split(/\s+OR\s+/)
    .some((alternative) => alternative.split(/\s+AND\s+/).every((id) => ALLOWED.has(id.trim())));
}

const problems: string[] = [];
const prod = licences(true);
console.log('Production dependencies by licence:');
for (const [licence, packages] of Object.entries(prod).sort()) {
  console.log(`  ${licence.padEnd(28)} ${packages.length}`);
  if (acceptable(licence)) continue;
  for (const p of packages) {
    if (EXCEPTIONS[p.name])
      console.log(`    accepted exception: ${p.name} (${EXCEPTIONS[p.name]})`);
    else
      problems.push(
        `${p.name}@${p.versions.join(',')} is a production dependency under ${licence}`,
      );
  }
}

for (const [licence, packages] of Object.entries(licences(false))) {
  if (!COPYLEFT.test(licence)) continue;
  for (const p of packages) problems.push(`${p.name}@${p.versions.join(',')} is under ${licence}`);
}

if (problems.length > 0) {
  console.error(`\nLicence check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\nLicence check passed.');
