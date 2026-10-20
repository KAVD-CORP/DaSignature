import { describe, expect, it } from 'vitest';
import { toBase64 } from '@dasignature/storage';
import { filesBridge, keyStore, sqliteBridge } from './mobile.ts';
import type { MobileNative } from './native.ts';

function fakeNative() {
  const files = new Map<string, string>();
  const calls: { sql: string; values: unknown[] }[] = [];
  const n = {
    dbRun: (o: { sql: string; values: unknown[] }) => {
      calls.push(o);
      return Promise.resolve();
    },
    dbQuery: () =>
      Promise.resolve({ rows: [{ id: 'a', data: { $blob: toBase64(new Uint8Array([1, 2])) } }] }),
    fileWrite: (o: { path: string; data: string }) => {
      files.set(o.path, o.data);
      return Promise.resolve();
    },
    fileRead: (o: { path: string }) => Promise.resolve({ data: files.get(o.path) ?? null }),
    fileRemove: (o: { path: string }) => {
      files.delete(o.path);
      return Promise.resolve();
    },
    usage: () => Promise.resolve({ used: files.size }),
    secretGetOrCreate: ({ name }: { name: string }) =>
      Promise.resolve({ secret: toBase64(new Uint8Array(name === 'bad' ? 4 : 32).fill(7)) }),
    secretDelete: () => Promise.resolve(),
  };
  return { n: n as unknown as MobileNative, calls };
}

describe('mobile native bridges', () => {
  it('encodes SQL values in the {$blob} wire format and decodes rows', async () => {
    const { n, calls } = fakeNative();
    const db = sqliteBridge(n);
    await db.run('INSERT INTO t VALUES (?, ?, ?)', [new Uint8Array([9]), true, undefined]);
    expect(calls[0]?.values).toEqual([{ $blob: 'CQ==' }, 1, null]);
    const rows = await db.query('SELECT 1', []);
    expect(rows[0]?.data).toEqual(new Uint8Array([1, 2]));
  });
  it('round-trips files as base64 and reports missing files as null', async () => {
    const f = filesBridge(fakeNative().n);
    await f.write('files/x', new Uint8Array([1, 2, 3]));
    expect(await f.read('files/x')).toEqual(new Uint8Array([1, 2, 3]));
    await f.remove('files/x');
    expect(await f.read('files/x')).toBeNull();
  });
  it('accepts only 32-byte Keystore secrets', async () => {
    const k = keyStore(fakeNative().n);
    expect((await k.getOrCreateSecret('dasig.db')).length).toBe(32);
    await expect(k.getOrCreateSecret('bad')).rejects.toThrow(/malformed/);
  });
});
