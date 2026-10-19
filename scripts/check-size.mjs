// Enforces the web initial-JS budget (SPEC Sec 1: < 250 KB gzipped).
// "Initial" = every JS file referenced by dist/index.html (entry + modulepreloads).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { initialChunks } from './initial-chunks.mjs';

const BUDGET_BYTES = 250 * 1024;
const dist = process.env.DASIG_WEB_DIST ?? new URL('../apps/web/dist/', import.meta.url).pathname;

let scripts;
try {
  scripts = initialChunks(dist);
} catch {
  console.error('apps/web/dist/index.html not found. Run `pnpm build` first.');
  process.exit(1);
}
if (scripts.length === 0) {
  console.error('No initial JS found in dist/index.html.');
  process.exit(1);
}

let total = 0;
for (const file of scripts) {
  const size = gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
  total += size;
  console.log(`  ${file}: ${(size / 1024).toFixed(1)} KB gzip`);
}
const pct = ((total / BUDGET_BYTES) * 100).toFixed(1);
console.log(`Initial JS: ${(total / 1024).toFixed(1)} KB gzip / 250 KB budget (${pct}%)`);
if (total > BUDGET_BYTES) {
  console.error('FAIL: web initial JS exceeds the 250 KB gzip budget.');
  process.exit(1);
}
console.log('OK: within budget.');
