import { describe, expect, it } from 'vitest';
import { CapacitorStorageAdapter } from '../src/adapters/capacitor.ts';
import { TAURI_COMMANDS, TauriStorageAdapter } from '../src/adapters/tauri.ts';
import { randomBytes } from '../src/bytes.ts';
import { migrate } from '../src/schema.ts';
import { runStorageContract } from './contract.ts';
import { FakeCapacitor, fakeTauriInvoke } from './fakes.ts';

runStorageContract('CapacitorStorageAdapter', () => {
  const native = new FakeCapacitor();
  return {
    key: 'sqlcipher-test-key',
    create: (o) =>
      new CapacitorStorageAdapter({ ...o, sqlite: native.sqlite, files: native.files }),
  };
});

runStorageContract('TauriStorageAdapter', () => {
  const { invoke } = fakeTauriInvoke();
  return { create: (o) => new TauriStorageAdapter(invoke, o) };
});

describe('native adapter specifics', () => {
  it('Capacitor takes the SQLCipher key from the keystore when init() has none', async () => {
    const native = new FakeCapacitor();
    const secrets: string[] = [];
    const keyStore = {
      getOrCreateSecret: (n: string) => (
        secrets.push(n),
        Promise.resolve(new Uint8Array(32).fill(7))
      ),
      deleteSecret: () => Promise.resolve(),
    };
    const a = new CapacitorStorageAdapter({ sqlite: native.sqlite, files: native.files, keyStore });
    await a.init({});
    await migrate(a);
    await a.close();
    expect(secrets).toEqual(['dasig.db']);
    // Reopening with a different key fails like SQLCipher does.
    const b = new CapacitorStorageAdapter({ sqlite: native.sqlite, files: native.files });
    await expect(b.init({ key: 'wrong' })).rejects.toThrow(/not a database/);
    await expect(
      new CapacitorStorageAdapter({ sqlite: native.sqlite, files: native.files }).init({}),
    ).rejects.toThrow(/no database key/);
  });

  it('Tauri uses only the documented commands and the {$blob} wire format', async () => {
    const { invoke, calls } = fakeTauriInvoke();
    const a = new TauriStorageAdapter(invoke);
    await a.init({});
    await a.exec('CREATE TABLE b (v BLOB)');
    const blob = randomBytes(33);
    await a.exec('INSERT INTO b VALUES (?)', [blob]);
    const [row] = await a.query<{ v: Uint8Array }>('SELECT v FROM b');
    expect(row?.v).toEqual(blob);
    await a.getFile(await a.putFile(blob)).then((b) => {
      expect(b).toEqual(blob);
    });
    await a.usage();
    await a.close();
    expect(new Set(calls).size).toBeLessThanOrEqual(TAURI_COMMANDS.length);
    for (const c of calls) expect(TAURI_COMMANDS).toContain(c);
  });
});
