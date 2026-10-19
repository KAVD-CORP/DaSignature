/**
 * The test-only hooks (raw persisted bytes, data-key export) and the native fakes must not be
 * reachable from production code. ESLint enforces the import side for packages/storage/src;
 * this test checks the shipped entry point and sources directly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

describe('test-only hooks stay out of production', () => {
  const sources = walk(join(root, 'src')).map((f) => ({ f, s: readFileSync(f, 'utf8') }));

  it('src/ never imports test code, harnesses or fakes', () => {
    for (const { f, s } of sources)
      expect(s, f).not.toMatch(/from\s+['"][^'"]*(\/test\/|\/harness\/|qa-harness|fakes)/);
  });

  it('src/ never exports raw key bytes or dumps raw storage', () => {
    for (const { f, s } of sources) {
      expect(s, f).not.toMatch(/subtle\s*\.\s*exportKey|exportKey\s*\(/);
      expect(s, f).not.toMatch(/rawBytes|exportDataKey|exportWebDataKey|kvRawBytes/);
    }
  });

  it('the package entry point exposes no hook', () => {
    const names = Object.keys(api);
    for (const bad of [
      'rawBytes',
      'exportDataKey',
      'exportWebDataKey',
      'kvRawBytes',
      'FakeCapacitor',
      'fakeTauriInvoke',
    ])
      expect(names).not.toContain(bad);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports).toEqual({ '.': './src/index.ts' });
  });

  it('vaults handed to app code hold non-extractable keys', async () => {
    const vault = await new api.WebKeyManager(new api.MemoryKeyValueStore()).unlock();
    expect(vault.key.extractable).toBe(false);
  });
});
