import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { concatBytes, fromBase64, fromUtf8, sha256Hex, utf8 } from '../src/bytes.ts';
import {
  CHUNK_SIZE,
  createBackup,
  decryptDasig,
  encodeDasig,
  MANIFEST_FIELDS,
  openBackup,
  readManifest,
  restoreBackup as restoreRaw,
} from '../src/backup.ts';
import {
  BackupCorruptError,
  BackupFormatError,
  BackupPasswordError,
  BackupVersionError,
  isUpdateRequired,
  RestoreNotConfirmedError,
} from '../src/errors.ts';
import { SCHEMA_VERSION, TABLES } from '../src/schema.ts';
import type { DataStore } from '../src/datastore.ts';
import { FAST_KDF, includes, MARKERS, memoryStore, seed } from './helpers.ts';

const PW = 'correct horse battery staple';

async function snapshot(store: DataStore) {
  const dump = await store.dumpPlain();
  const strip = (rows: Record<string, unknown>[]) =>
    rows.map((r) => {
      const rest = { ...r };
      delete rest.file_ref;
      delete rest.image_ref;
      return rest;
    });
  const hashes: string[] = [];
  for (const b of dump.files.values()) hashes.push(await sha256Hex(b));
  return {
    tables: Object.fromEntries(TABLES.map((t) => [t, strip(dump.tables[t])])),
    hashes: hashes.sort(),
  };
}

const CONFIRM = { confirmReplaceAll: true } as const;
const restoreBackup = (store: DataStore, file: Uint8Array, pw: string) =>
  restoreRaw(store, file, pw, CONFIRM);
const rezip = (o: Record<string, Uint8Array>) => zipSync(o, { level: 0 });
const manifestOf = (file: Uint8Array) =>
  JSON.parse(fromUtf8(unzipSync(file)['manifest.json'] as Uint8Array)) as Record<string, unknown>;

describe('BAK-01 .dasig backup', () => {
  it('round trip: backup, wipe, restore gives identical rows and file hashes', async () => {
    const a = await memoryStore();
    await seed(a.store);
    const before = await snapshot(a.store);
    const file = await createBackup(a.store, PW, { kdf: FAST_KDF(), appVersion: '0.2.0' });

    // Restore into a different device (fresh store, different data key) that has other data.
    const b = await memoryStore();
    await b.store.addDocument({ title: 'other', pdf: utf8('%PDF-other'), pageCount: 1 });
    const res = await restoreBackup(b.store, file, PW);
    expect(res).toEqual({ documents: 1, files: 3 });
    expect(await snapshot(b.store)).toEqual(before);
    expect(b.backend.files.size).toBe(3); // old file removed, three restored
    const [doc] = await b.store.listDocuments();
    expect(doc && (await sha256Hex(await b.store.getDocumentPdf(doc)))).toBe(doc?.sha256);

    // Restore over the same store too (wipe and replace).
    await restoreBackup(a.store, file, PW);
    expect(await snapshot(a.store)).toEqual(before);
    expect(a.backend.files.size).toBe(3);
  });

  it('PM #68: restore without the explicit replace confirmation is refused and changes nothing', async () => {
    const a = await memoryStore();
    await seed(a.store);
    const file = await createBackup(a.store, PW, { kdf: FAST_KDF() });
    const b = await memoryStore();
    await b.store.addDocument({ title: 'keep', pdf: utf8('%PDF-keep'), pageCount: 1 });
    const before = await snapshot(b.store);
    for (const bad of [undefined, {}, { confirmReplaceAll: 'yes' }, { confirmReplaceAll: 1 }]) {
      await expect(
        restoreRaw(b.store, file, PW, bad as unknown as { confirmReplaceAll: true }),
      ).rejects.toBeInstanceOf(RestoreNotConfirmedError);
    }
    const dump = await openBackup(file, PW);
    await expect(
      b.store.replaceAll(dump, {} as unknown as { confirmReplaceAll: true }),
    ).rejects.toBeInstanceOf(RestoreNotConfirmedError);
    expect(await snapshot(b.store)).toEqual(before);
  });

  it('PM #68: the confirm-sheet callback is asked once after validation; Cancel changes nothing', async () => {
    const a = await memoryStore();
    await seed(a.store);
    const file = await createBackup(a.store, PW, { kdf: FAST_KDF() });
    const b = await memoryStore();
    await b.store.addDocument({ title: 'keep', pdf: utf8('%PDF-keep'), pageCount: 1 });
    const before = await snapshot(b.store);
    let asked = 0;
    const cancel = () => {
      asked++;
      return Promise.resolve(false);
    };
    await expect(restoreRaw(b.store, file, PW, cancel)).rejects.toBeInstanceOf(
      RestoreNotConfirmedError,
    );
    expect(asked).toBe(1);
    // An unreadable file never reaches the confirm sheet.
    await expect(restoreRaw(b.store, file, 'wrong', cancel)).rejects.toBeInstanceOf(
      BackupPasswordError,
    );
    expect(asked).toBe(1);
    expect(await snapshot(b.store)).toEqual(before);
    await restoreRaw(b.store, file, PW, () => Promise.resolve(true));
    expect(await snapshot(b.store)).toEqual(await snapshot(a.store));
  });

  it('works with the production Argon2id parameters and a multi-chunk payload', async () => {
    const a = await memoryStore();
    await seed(a.store);
    const big = new Uint8Array(CHUNK_SIZE * 2 + 123);
    crypto.getRandomValues(big.subarray(0, 65536));
    await a.store.addDocument({ title: 'big', pdf: big, pageCount: 9 });
    const file = await createBackup(a.store, PW);
    const { manifest, payload } = readManifest(file);
    expect(manifest.kdf).toEqual({
      alg: 'argon2id',
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1,
    });
    expect(payload.length).toBeGreaterThan(2 * (CHUNK_SIZE + 16)); // three chunks
    const b = await memoryStore();
    await restoreBackup(b.store, file, PW);
    expect(await snapshot(b.store)).toEqual(await snapshot(a.store));
  }, 60_000);

  it('PM #66: every backup has its own random salt and nonce', async () => {
    const a = await memoryStore();
    const m1 = manifestOf(await createBackup(a.store, PW));
    const m2 = manifestOf(await createBackup(a.store, PW));
    expect(fromBase64(String(m1.salt))).toHaveLength(16);
    expect(fromBase64(String(m1.iv))).toHaveLength(12);
    expect(m1.salt).not.toBe(m2.salt);
    expect(m1.iv).not.toBe(m2.iv);
  }, 60_000);

  it('PM #67: the plaintext manifest has exactly the allowed fields and no user content or counts', async () => {
    const a = await memoryStore();
    await seed(a.store);
    const file = await createBackup(a.store, PW, { kdf: FAST_KDF(), appVersion: '0.2.0' });
    const m = manifestOf(file);
    // Fails if any field beyond PM #67's list appears (counts, schema version, titles, hashes...).
    expect(Object.keys(m).sort()).toEqual([...MANIFEST_FIELDS].sort());
    expect(Object.keys(m).sort()).toEqual([
      'appVersion',
      'cipher',
      'createdAt',
      'iv',
      'kdf',
      'salt',
      'version',
    ]);
    expect(Object.keys(m.kdf as object).sort()).toEqual(['alg', 'iterations']);
    expect(m).toMatchObject({ version: 1, appVersion: '0.2.0', cipher: 'AES-256-GCM' });
    for (const v of Object.values(m))
      expect(typeof v === 'number' && v > 1 && v !== 1000).toBe(false);
    // A reader refuses manifests that carry anything else.
    const patched = await encodeDasig(
      (await decryptDasig(file, PW)).plain,
      PW,
      {
        createdAt: String(m.createdAt),
        appVersion: '0.2.0',
        kdf: FAST_KDF(),
      },
      (x) => ({ ...x, documentCount: 1 }),
    );
    await expect(openBackup(patched, PW)).rejects.toThrow(
      /unexpected manifest fields: documentCount/,
    );
  });

  it('raw .dasig bytes contain no plaintext title, signature path, signer or %PDF', async () => {
    const a = await memoryStore();
    await seed(a.store);
    const file = await createBackup(a.store, PW, { kdf: FAST_KDF() });
    for (const m of [
      ...Object.values(MARKERS),
      '%PDF',
      'My signature',
      'strokes_json',
      'schemaVersion',
    ])
      expect(includes(file, m)).toBe(false);
    expect(Object.keys(unzipSync(file)).sort()).toEqual([
      'README.txt',
      'manifest.json',
      'payload.bin',
    ]);
  });

  it('wrong password fails cleanly with no partial restore', async () => {
    const a = await memoryStore();
    await seed(a.store);
    const file = await createBackup(a.store, PW, { kdf: FAST_KDF() });
    const b = await memoryStore();
    await b.store.addDocument({ title: 'keep me', pdf: utf8('%PDF-keep'), pageCount: 1 });
    const before = await snapshot(b.store);
    await expect(restoreBackup(b.store, file, 'wrong')).rejects.toBeInstanceOf(BackupPasswordError);
    expect(await snapshot(b.store)).toEqual(before);
    expect(b.backend.files.size).toBe(1);
  });

  it('detects corruption anywhere (payload bit flips, truncation, manifest edit, container damage)', async () => {
    const a = await memoryStore();
    await seed(a.store);
    const big = new Uint8Array(CHUNK_SIZE + 5000);
    crypto.getRandomValues(big.subarray(0, 65536));
    await a.store.addDocument({ title: 'big', pdf: big, pageCount: 1 });
    const file = await createBackup(a.store, PW, { kdf: FAST_KDF() });
    const outer = unzipSync(file);
    const payload = outer['payload.bin'] as Uint8Array;
    const flipAt = (b: Uint8Array, i: number) => {
      const c = b.slice();
      c[i] = (c[i] ?? 0) ^ 0x01;
      return c;
    };
    for (const pos of [20, CHUNK_SIZE + 100, payload.length - 1]) {
      await expect(
        openBackup(rezip({ ...outer, 'payload.bin': flipAt(payload, pos) }), PW),
      ).rejects.toBeInstanceOf(BackupCorruptError);
    }
    // Dropping the last chunk (truncation at a chunk boundary) is caught by the "last" flag in the AAD.
    await expect(
      openBackup(rezip({ ...outer, 'payload.bin': payload.subarray(0, 16 + CHUNK_SIZE + 16) }), PW),
    ).rejects.toBeInstanceOf(BackupCorruptError);
    const m = manifestOf(file);
    const edited = utf8(JSON.stringify({ ...m, createdAt: '2000-01-01T00:00:00.000Z' }, null, 2));
    await expect(
      openBackup(rezip({ ...outer, 'manifest.json': edited }), PW),
    ).rejects.toBeInstanceOf(BackupCorruptError);
    // Container: every single-bit flip in the ZIP structure, appended bytes, truncation.
    for (const pos of [0, 8, 30, 40, file.length - 30, file.length - 1]) {
      await expect(openBackup(flipAt(file, pos), PW)).rejects.toBeTruthy();
    }
    await expect(
      openBackup(concatBytes(file, new Uint8Array([1, 2, 3])), PW),
    ).rejects.toBeInstanceOf(BackupCorruptError);
    await expect(openBackup(file.subarray(0, 100), PW)).rejects.toBeInstanceOf(BackupCorruptError);
    await expect(openBackup(utf8('hello'), PW)).rejects.toBeInstanceOf(BackupCorruptError);
    await expect(openBackup(rezip({ 'x.txt': utf8('x') }), PW)).rejects.toBeInstanceOf(
      BackupFormatError,
    );

    // A failing restore leaves the target untouched.
    const b = await memoryStore();
    await seed(b.store);
    const before = await snapshot(b.store);
    await expect(
      restoreBackup(b.store, rezip({ ...outer, 'payload.bin': flipAt(payload, 20) }), PW),
    ).rejects.toBeInstanceOf(BackupCorruptError);
    expect(await snapshot(b.store)).toEqual(before);
  });

  it('PM #69: a newer format or data schema is refused with an update-required error, data untouched', async () => {
    const a = await memoryStore();
    await seed(a.store);
    const file = await createBackup(a.store, PW, { kdf: FAST_KDF() });
    const { plain } = await decryptDasig(file, PW);
    const o = { createdAt: '2026-10-19T00:00:00.000Z', appVersion: '9.0.0', kdf: FAST_KDF() };
    const futureFormat = await encodeDasig(plain, PW, o, (m) => ({ ...m, version: 2 }));
    const inner = unzipSync(plain);
    const data = JSON.parse(fromUtf8(inner['data.json'] as Uint8Array)) as Record<string, unknown>;
    const futureSchema = await encodeDasig(
      zipSync({
        ...inner,
        'data.json': utf8(JSON.stringify({ ...data, schemaVersion: SCHEMA_VERSION + 1 })),
      }),
      PW,
      o,
    );
    const b = await memoryStore();
    await b.store.addDocument({ title: 'keep', pdf: utf8('%PDF-keep'), pageCount: 1 });
    const before = await snapshot(b.store);
    for (const f of [futureFormat, futureSchema]) {
      const err = await restoreBackup(b.store, f, PW).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BackupVersionError);
      expect(isUpdateRequired(err)).toBe(true);
      expect((err as BackupVersionError).messageKey).toBe('storage.updateRequired.backup');
    }
    expect(await snapshot(b.store)).toEqual(before);
  });

  it('backs up an empty store and refuses an empty password', async () => {
    const a = await memoryStore();
    const file = await createBackup(a.store, PW, { kdf: FAST_KDF() });
    const b = await memoryStore();
    await seed(b.store);
    await restoreBackup(b.store, file, PW);
    expect(await b.store.listDocuments()).toEqual([]);
    expect(b.backend.files.size).toBe(0);
    await expect(createBackup(a.store, '')).rejects.toThrow(RangeError);
  });
});
