// Pulls a new Designer token drop into packages/ui/tokens/ (the single source of truth; src/tokens.ts
// and src/tailwind-preset.ts read from it). Usage: node scripts/sync-design-tokens.mjs <design/tokens dir>
// Afterwards: add any new token *names* to src/tokens.ts if code needs them, then `pnpm lint && pnpm test`.
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

const from = process.argv[2];
if (!from) {
  console.error('usage: node scripts/sync-design-tokens.mjs <design/tokens dir>');
  process.exit(2);
}
const root = new URL('..', import.meta.url).pathname;
const dest = join(root, 'packages/ui/tokens');
const FILES = [
  'tokens.json',
  'build.py',
  'check_contrast.py',
  'tokens.css',
  'theme.css',
  'tailwind.preset.js',
  'contrast-report.md',
  'README.md',
];
for (const f of FILES) copyFileSync(join(from, f), join(dest, f));

console.log(`Synced ${String(FILES.length)} files from ${from}.`);
