import { describe, expect, it } from 'vitest';
import { WebStorageAdapter } from '../src/adapters/web.ts';
import { fromBase64, toBase64 } from '../src/bytes.ts';
import { IdbKeyValueStore, WebKeyManager } from '../src/crypto/keys.ts';
import { IV_BYTES, TAG_BYTES } from '../src/crypto/vault.ts';
import { DataStore } from '../src/datastore.ts';
import { ENCRYPTED_COLUMNS } from '../src/fields.ts';
import { TABLES } from '../src/schema.ts';
import { runStorageContract } from './contract.ts';
import { FAST_KDF, includes, MARKERS, seed } from './helpers.ts';

let n = 0;
const unique = () => {
  const id = `${String(Date.now())}-${String(n++)}`;
  return { vfsDir: `.t-sqlite-${id}`, filesDir: `t-files-${id}`, dbName: 'test.sqlite3' };
};
async function removeDirs(...names: string[]) {
  const root = await navigator.storage.getDirectory();
  for (const name of names)
    await root.removeEntry(name, { recursive: true }).catch(() => undefined);
}
async function readAllOpfs(dir: FileSystemDirectoryHandle): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const h of (
    dir as unknown as { values(): AsyncIterable<FileSystemHandle> }
  ).values()) {
    if (h.kind === 'file')
      out.push(new Uint8Array(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer()));
    else out.push(...(await readAllOpfs(h as FileSystemDirectoryHandle)));
  }
  return out;
}

runStorageContract('WebStorageAdapter', () => {
  const cfg = unique();
  return {
    create: (o) => new WebStorageAdapter({ ...cfg, ...o }),
    destroy: () => removeDirs(cfg.vfsDir, cfg.filesDir),
  };
});

describe('ENC-02 web: OPFS bytes are ciphertext', () => {
  it('no %PDF or fixture strings anywhere in OPFS; encrypted columns are IV+ct+tag; no IV reuse', async () => {
    const cfg = unique();
    const kv = new IdbKeyValueStore(`dasig-keys-test-${cfg.filesDir}`);
    const vault = await new WebKeyManager(kv, FAST_KDF).unlock();
    const db = new WebStorageAdapter(cfg);
    await db.init({});
    const store = await DataStore.open(db, vault);
    await seed(store);

    const ivs = new Set<string>();
    let count = 0;
    for (const t of TABLES) {
      for (const col of ENCRYPTED_COLUMNS[t]) {
        for (const r of await db.query<{ v: string | null }>(`SELECT ${col} AS v FROM ${t}`)) {
          if (r.v === null) continue;
          const raw = fromBase64(r.v);
          expect(raw.length).toBeGreaterThanOrEqual(IV_BYTES + TAG_BYTES);
          ivs.add(toBase64(raw.subarray(0, IV_BYTES)));
          count++;
        }
      }
    }
    expect(ivs.size).toBe(count);
    expect(
      (await db.query<{ title: string }>('SELECT status, page_count FROM documents'))[0],
    ).toEqual({ status: 'draft', page_count: 2 });
    await db.close();

    const root = await navigator.storage.getDirectory();
    const blobs = [
      ...(await readAllOpfs(await root.getDirectoryHandle(cfg.vfsDir))),
      ...(await readAllOpfs(await root.getDirectoryHandle(cfg.filesDir))),
    ];
    const total = blobs.reduce((s, b) => s + b.length, 0);
    expect(total).toBeGreaterThan(8192);
    for (const b of blobs) {
      for (const m of [...Object.values(MARKERS), '%PDF', 'My signature'])
        expect(includes(b, m), m).toBe(false);
    }
    // The schema itself is plaintext (PM #17): proves we scanned the real database file.
    expect(blobs.some((b) => includes(b, 'CREATE TABLE documents'))).toBe(true);

    // Reopen in a new worker with the same IndexedDB key: data is readable again.
    const db2 = new WebStorageAdapter(cfg);
    await db2.init({});
    const store2 = await DataStore.open(db2, await new WebKeyManager(kv, FAST_KDF).unlock());
    expect((await store2.listDocuments())[0]?.title).toBe(MARKERS.title);
    await db2.close();
    kv.close();
    await removeDirs(cfg.vfsDir, cfg.filesDir);
  });
});
