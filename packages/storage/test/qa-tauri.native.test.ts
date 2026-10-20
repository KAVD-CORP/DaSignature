/**
 * QA's contract suites and the Engineer suite against the REAL desktop backend: TauriStorageAdapter
 * -> JSON-lines bridge -> rusqlite + SQLCipher (src-tauri/src/storage.rs) on a real temp directory.
 * Encryption runs in 'sqlcipher' mode (ENC-01, Linux): raw bytes are the files on disk.
 * Run with `pnpm --filter @dasignature/storage test:native` (builds the cargo example first).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TauriSecureKeyStore, TauriStorageAdapter } from '../src/adapters/tauri.ts';
import { randomBytes } from '../src/bytes.ts';
import { NativeKeyManager } from '../src/crypto/keys.ts';
import type { SecureKeyStore } from '../src/types.ts';
import { runStorageContract as runEngineerContract } from './contract.ts';
import { runStorageContract } from './qa/contract.ts';
import { runMigrationContract } from './qa/migrations-contract.ts';
import { runEncryptionContract } from './qa/encryption-contract.ts';
import { runBackupContract } from './qa/backup-contract.ts';
import { runFileNameScan } from './file-names.ts';
import { startNative, type NativeProcess } from './native-ipc.ts';
import {
  backupHarness,
  encryptionHarness,
  type Kit,
  migrationHarness,
  storageHarness,
} from './qa-harness.ts';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The OS keystore stand-in: process memory, outside the app-data dir (as Keychain etc. are). */
function memoryKeystore(): SecureKeyStore {
  const secrets = new Map<string, Uint8Array>();
  return {
    getOrCreateSecret: (n) => {
      if (!secrets.has(n)) secrets.set(n, randomBytes(32));
      return Promise.resolve(secrets.get(n) as Uint8Array);
    },
    deleteSecret: (n) => {
      secrets.delete(n);
      return Promise.resolve();
    },
  };
}

type NativeKit = Kit & { adapter(opts?: { lockTimeoutMs: number }): TauriStorageAdapter };

function realTauriKit(): NativeKit {
  let dir = '';
  const procs: NativeProcess[] = [];
  let sqlcipherKey = randomBytes(32);
  let ks = memoryKeystore();
  const fresh = () => {
    const root = mkdtempSync(join(tmpdir(), 'dasig-native-'));
    roots.push(root);
    dir = join(root, 'app-data');
  };
  fresh();
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  const kit: NativeKit = {
    get initOpts() {
      return { key: hex(sqlcipherKey) };
    },
    adapter: (opts?: { lockTimeoutMs: number }) => {
      // One bridge process per adapter instance, like one app process.
      const p = startNative(dir);
      procs.push(p);
      const a = new TauriStorageAdapter(p.invoke, opts);
      const close = a.close.bind(a);
      a.close = async () => {
        await close();
        await p.stop();
      };
      return a;
    },
    keys: {
      vault: async () => ({
        vault: (
          (v) => () =>
            v
        )(await new NativeKeyManager(ks).unlock()),
      }),
    },
    encMode: 'sqlcipher',
    rawBytes: () =>
      Promise.resolve(
        walk(dir).map((f) => ({ path: relative(dir, f), bytes: new Uint8Array(readFileSync(f)) })),
      ),
    // In SQLCipher mode the data key at rest is the database key (held by the OS keystore).
    dataKey: () => Promise.resolve(sqlcipherKey),
    wipe: async () => {
      await Promise.all(procs.splice(0).map((p) => p.stop()));
      fresh();
      sqlcipherKey = randomBytes(32);
      ks = memoryKeystore();
    },
  };
  return kit;
}

const name = 'TauriStorageAdapter (rusqlite + SQLCipher)';
runStorageContract(name, storageHarness(realTauriKit()));
runMigrationContract(name, migrationHarness(realTauriKit()));
runEncryptionContract(name, encryptionHarness(realTauriKit()));
runBackupContract(name, backupHarness(realTauriKit()));
runFileNameScan(name, realTauriKit());

runEngineerContract(name, () => {
  const kit = realTauriKit();
  return {
    create: (opts) => kit.adapter(opts),
    key: kit.initOpts.key,
    destroy: () => kit.wipe(),
  };
});

describe('TauriSecureKeyStore against the real secrets.rs (M3)', () => {
  it('creates a 32-byte secret once, returns it again, deletes it, rejects bad names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dasig-secrets-'));
    roots.push(root);
    const p = startNative(join(root, 'app-data'));
    try {
      const ks = new TauriSecureKeyStore(p.invoke);
      const a = await ks.getOrCreateSecret('dasig.dek');
      expect(a.length).toBe(32);
      expect(await ks.getOrCreateSecret('dasig.dek')).toEqual(a);
      await ks.deleteSecret('dasig.dek');
      expect(await ks.getOrCreateSecret('dasig.dek')).not.toEqual(a);
      await expect(ks.getOrCreateSecret('../database-key')).rejects.toThrow(/invalid secret name/);
      // NativeKeyManager on top: the data key comes from the OS store and opens a vault.
      const vault = await new NativeKeyManager(ks).unlock();
      const sealed = await vault.seal(new Uint8Array([1, 2, 3]), 'documents.title', 'x');
      expect(await vault.open(sealed, 'documents.title', 'x')).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      await p.stop();
    }
  });
});
