// SIZE-01 (SPEC Sec 1, PM #2/#3): web initial JS < 250 KiB gzip. The file list is derived from
// apps/web/dist/index.html (entry + every modulepreload), so a new or renamed chunk can't escape
// the budget (QA-M1-03). Run after `pnpm build`.
import { existsSync } from 'node:fs';
import { initialChunks } from './scripts/initial-chunks.mjs';

const dist = 'apps/web/dist';
if (!existsSync(`${dist}/index.html`)) {
  throw new Error('apps/web/dist/index.html not found. Run `pnpm build` first.');
}

export default [
  {
    name: 'web initial JS (index.html entry + all modulepreloads, gzip) - SPEC Sec 1 / PM #2, #3',
    path: initialChunks(dist).map((f) => `${dist}/${f}`),
    limit: '250 KiB',
    gzip: true,
  },
];
