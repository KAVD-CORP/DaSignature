/**
 * QA's contract suites (test/qa, verbatim copies of qa/contract/storage) against the adapters that
 * run in Node: memory (real SQLite engine) and the Capacitor / Tauri bridges with their fakes.
 * The web adapter runs the same suites in Chromium (qa-web.browser.test.ts).
 */
import { MemoryBackend, MemoryStorageAdapter } from '../src/adapters/memory.ts';
import { CapacitorStorageAdapter } from '../src/adapters/capacitor.ts';
import { TauriStorageAdapter } from '../src/adapters/tauri.ts';
import { randomBytes } from '../src/bytes.ts';
import { MemoryKeyValueStore, NativeKeyManager } from '../src/crypto/keys.ts';
import type { SecureKeyStore } from '../src/types.ts';
import { runStorageContract } from './qa/contract.ts';
import { runMigrationContract } from './qa/migrations-contract.ts';
import { runEncryptionContract } from './qa/encryption-contract.ts';
import { runBackupContract } from './qa/backup-contract.ts';
import { FakeCapacitor, fakeTauriInvoke } from './fakes.ts';
import {
  backupHarness,
  encryptionHarness,
  exportWebDataKey,
  type Kit,
  kvRawBytes,
  migrationHarness,
  storageHarness,
} from './qa-harness.ts';

function memoryKit(): Kit {
  let backend = new MemoryBackend();
  let kv = new MemoryKeyValueStore();
  return {
    initOpts: {},
    adapter: () => new MemoryStorageAdapter(backend),
    keys: 'web',
    kv: () => kv,
    rawBytes: async () => [
      ...(backend.image ? [{ path: 'memory/dasignature.sqlite3', bytes: backend.image }] : []),
      ...[...backend.files].map(([ref, bytes]) => ({ path: `memory/files/${ref}`, bytes })),
      ...(await kvRawBytes(kv)),
    ],
    dataKey: () => exportWebDataKey(kv),
    wipe: () => {
      backend = new MemoryBackend();
      kv = new MemoryKeyValueStore();
      return Promise.resolve();
    },
  };
}

/** Fake OS keystore (Keychain / Keystore / credential store): outside the app's data files. */
function fakeKeystore(): SecureKeyStore & { secrets: Map<string, Uint8Array> } {
  const secrets = new Map<string, Uint8Array>();
  return {
    secrets,
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

function nativeKit(kind: 'capacitor' | 'tauri'): Kit {
  let ks = fakeKeystore();
  let cap = new FakeCapacitor();
  let tauri = fakeTauriInvoke();
  const backend = () => (kind === 'capacitor' ? cap.backend : tauri.backend);
  return {
    initOpts: kind === 'capacitor' ? { key: 'qa-sqlcipher-key' } : {},
    adapter: () =>
      kind === 'capacitor'
        ? new CapacitorStorageAdapter({ sqlite: cap.sqlite, files: cap.files })
        : new TauriStorageAdapter(tauri.invoke),
    keys: {
      vault: async () => ({
        vault: (
          (v) => () =>
            v
        )(await new NativeKeyManager(ks).unlock()),
      }),
    },
    rawBytes: () => {
      const b = backend();
      return Promise.resolve([
        ...(b.image ? [{ path: `${kind}/dasignature.db`, bytes: b.image }] : []),
        ...[...b.files].map(([ref, bytes]) => ({ path: `${kind}/${ref}`, bytes })),
      ]);
    },
    dataKey: async () => ks.getOrCreateSecret('dasig.dek'),
    wipe: () => {
      ks = fakeKeystore();
      cap = new FakeCapacitor();
      tauri = fakeTauriInvoke();
      return Promise.resolve();
    },
  };
}

const kits: [string, () => Kit][] = [
  ['MemoryStorageAdapter', memoryKit],
  ['CapacitorStorageAdapter', () => nativeKit('capacitor')],
  ['TauriStorageAdapter', () => nativeKit('tauri')],
];

for (const [name, kit] of kits) {
  runStorageContract(name, storageHarness(kit()));
  runMigrationContract(name, migrationHarness(kit()));
  runEncryptionContract(name, encryptionHarness(kit()));
  runBackupContract(name, backupHarness(kit()));
}
