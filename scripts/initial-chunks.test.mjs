import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { initialChunksFromHtml } from './initial-chunks.mjs';

const html = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/main-AAA.js"></script>
<link rel="modulepreload" crossorigin href="/assets/index-BBB.js">
<link rel="modulepreload" crossorigin href="/assets/vendor-heavy-CCC.js">
<link rel="stylesheet" href="/assets/index-DDD.css">
</head></html>`;

describe('initial chunks (QA-M1-03)', () => {
  it('includes the entry and every modulepreload, whatever its name, and no CSS', () => {
    expect(initialChunksFromHtml(html)).toEqual([
      'assets/main-AAA.js',
      'assets/index-BBB.js',
      'assets/vendor-heavy-CCC.js',
    ]);
  });

  it('check-size fails when a differently named preloaded chunk blows the budget', () => {
    const dist = mkdtempSync(join(tmpdir(), 'dasig-size-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), html);
    writeFileSync(join(dist, 'assets/main-AAA.js'), 'console.log(1)');
    writeFileSync(join(dist, 'assets/index-BBB.js'), 'console.log(2)');
    // 300 KiB of incompressible data in a chunk that isn't named main-* or index-*.
    writeFileSync(
      join(dist, 'assets/vendor-heavy-CCC.js'),
      randomBytes(300 * 1024).toString('base64'),
    );
    let code = 0;
    try {
      execFileSync('node', [new URL('./check-size.mjs', import.meta.url).pathname], {
        env: { ...process.env, DASIG_WEB_DIST: dist },
        stdio: 'pipe',
      });
    } catch (e) {
      code = e.status;
    }
    expect(code).toBe(1);
  });
});
