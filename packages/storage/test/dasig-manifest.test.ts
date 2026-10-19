/**
 * BAK-01-C11/C13 on a real file: a freshly generated .dasig (production PM #18 Argon2id KDF) is
 * checked by QA's own scanner (scripts/qa/check-dasig-manifest.mjs, vendored verbatim).
 * DASIG_SAMPLE_OUT=<path> keeps the generated file (for evidence).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createBackup } from '../src/backup.ts';
import { memoryStore, seed } from './helpers.ts';

const SCRIPT = fileURLToPath(
  new URL('../../../scripts/qa/check-dasig-manifest.mjs', import.meta.url),
);

it('QA check-dasig-manifest passes on a freshly generated .dasig (PM #67, #18, #66)', async () => {
  const { store } = await memoryStore();
  await seed(store);
  const file = await createBackup(store, 'sample-password', { appVersion: '0.1.0' });
  const dir = mkdtempSync(join(tmpdir(), 'dasig-sample-'));
  const path = process.env.DASIG_SAMPLE_OUT ?? join(dir, 'sample.dasig');
  try {
    writeFileSync(path, file);
    const r = spawnSync(process.execPath, [SCRIPT, path], { encoding: 'utf8' });
    console.log(r.stdout);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(/PASS/);
    expect(r.status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
