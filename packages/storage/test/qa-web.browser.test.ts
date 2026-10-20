/** QA's contract suites against the real web adapter (sqlite-wasm on OPFS sahpool, Chromium). */
import { WebStorageAdapter } from '../src/adapters/web.ts';
import { IdbKeyValueStore } from '../src/crypto/keys.ts';
import { runStorageContract } from './qa/contract.ts';
import { runMigrationContract } from './qa/migrations-contract.ts';
import { runEncryptionContract } from './qa/encryption-contract.ts';
import { runBackupContract } from './qa/backup-contract.ts';
import { runFileNameScan } from './file-names.ts';
import {
  backupHarness,
  encryptionHarness,
  exportWebDataKey,
  type Kit,
  kvRawBytes,
  migrationHarness,
  type RawFile,
  storageHarness,
} from './qa-harness.ts';

let seq = 0;
async function readTree(dir: FileSystemDirectoryHandle, prefix: string): Promise<RawFile[]> {
  const out: RawFile[] = [];
  for await (const h of (
    dir as unknown as { values(): AsyncIterable<FileSystemHandle> }
  ).values()) {
    if (h.kind === 'file') {
      const f = await (h as FileSystemFileHandle).getFile();
      out.push({ path: `${prefix}/${h.name}`, bytes: new Uint8Array(await f.arrayBuffer()) });
    } else out.push(...(await readTree(h as FileSystemDirectoryHandle, `${prefix}/${h.name}`)));
  }
  return out;
}

function webKit(): Kit {
  const fresh = () => {
    const id = `${String(Date.now())}-${String(seq++)}`;
    return {
      vfsDir: `.qa-sqlite-${id}`,
      filesDir: `qa-files-${id}`,
      dbName: 'dasignature.sqlite3',
      idb: `qa-keys-${id}`,
    };
  };
  let cfg = fresh();
  let kv: IdbKeyValueStore | undefined;
  const getKv = () => (kv ??= new IdbKeyValueStore(cfg.idb));
  return {
    initOpts: {},
    adapter: () =>
      new WebStorageAdapter({ vfsDir: cfg.vfsDir, filesDir: cfg.filesDir, dbName: cfg.dbName }),
    keys: 'web',
    kv: getKv,
    // Every OPFS file of the store (SQLite sahpool files incl. journal slots, blobs) + the IndexedDB key record.
    rawBytes: async () => {
      const root = await navigator.storage.getDirectory();
      const out: RawFile[] = [];
      for (const d of [cfg.vfsDir, cfg.filesDir]) {
        const h = await root.getDirectoryHandle(d).catch(() => undefined);
        if (h) out.push(...(await readTree(h, `opfs/${d}`)));
      }
      return [...out, ...(await kvRawBytes(getKv()))];
    },
    dataKey: () => exportWebDataKey(getKv()),
    wipe: async () => {
      const root = await navigator.storage.getDirectory();
      for (const d of [cfg.vfsDir, cfg.filesDir])
        await root.removeEntry(d, { recursive: true }).catch(() => undefined);
      kv?.close();
      kv = undefined;
      const name = cfg.idb;
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess =
          req.onerror =
          req.onblocked =
            () => {
              resolve();
            };
      });
      cfg = fresh();
    },
  };
}

runStorageContract('WebStorageAdapter', storageHarness(webKit()));
runMigrationContract('WebStorageAdapter', migrationHarness(webKit()));
runEncryptionContract('WebStorageAdapter', encryptionHarness(webKit()));
runBackupContract('WebStorageAdapter', backupHarness(webKit()));
runFileNameScan('WebStorageAdapter', webKit());
