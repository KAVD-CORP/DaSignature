/** ADP-01 meta-check: every `implements StorageAdapter` class is run through runStorageContract. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

describe('ADP-01 contract registry', () => {
  it('every StorageAdapter implementation has a contract run', () => {
    const impls = walk(join(root, 'src')).flatMap((f) =>
      [
        ...readFileSync(f, 'utf8').matchAll(/class\s+(\w+)[^{]*\bimplements\s+StorageAdapter\b/g),
      ].map((m) => m[1]),
    );
    const runs = walk(join(root, 'test')).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/runStorageContract\(\s*'(\w+)'/g)].map((m) => m[1]),
    );
    expect(impls.sort()).toEqual([
      'CapacitorStorageAdapter',
      'MemoryStorageAdapter',
      'TauriStorageAdapter',
      'WebStorageAdapter',
    ]);
    expect([...new Set(runs)].sort()).toEqual(impls);
  });
});
