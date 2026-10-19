import { describe, expect, it } from 'vitest';
import { fromBase64, fromUtf8, sha256Hex, toBase64 } from '../src/bytes.ts';
import { IV_BYTES, TAG_BYTES } from '../src/crypto/vault.ts';
import { DecryptionError } from '../src/errors.ts';
import { ENCRYPTED_COLUMNS } from '../src/fields.ts';
import { TABLES } from '../src/schema.ts';
import { fakePdf, includes, MARKERS, memoryStore, newVault, seed } from './helpers.ts';
import { DataStore } from '../src/datastore.ts';

describe('DataStore encryption at rest (PM #17, #38; ENC-02 on the memory engine)', () => {
  it('stores the PM #17 fields as IV(12) + ciphertext + tag(16), each with its own IV', async () => {
    const { store, db } = await memoryStore();
    await seed(store);
    const ivs = new Set<string>();
    let n = 0;
    for (const t of TABLES) {
      for (const col of ENCRYPTED_COLUMNS[t]) {
        for (const r of await db.query<Record<string, string | null>>(
          `SELECT ${col} AS v FROM ${t}`,
        )) {
          if (r.v === null || r.v === undefined) continue;
          const raw = fromBase64(r.v);
          expect(raw.length).toBeGreaterThanOrEqual(IV_BYTES + TAG_BYTES);
          ivs.add(toBase64(raw.subarray(0, IV_BYTES)));
          n++;
        }
      }
    }
    expect(n).toBe(8); // title, 3 signature fields, data_json, signer_name, 2 template fields
    expect(ivs.size).toBe(n);
    const [s] = await db.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'signer_name'",
    );
    expect(s?.value).not.toContain('Ama');
  });

  it('keeps the PM #17 plaintext fields readable', async () => {
    const { store, db } = await memoryStore();
    const { doc } = await seed(store);
    const [row] = await db.query<Record<string, unknown>>('SELECT * FROM documents');
    expect(row).toMatchObject({
      id: doc.id,
      page_count: 2,
      status: 'draft',
      sha256: doc.sha256,
      created_at: doc.created_at,
    });
    expect(await db.query("SELECT value FROM settings WHERE key = 'theme'")).toEqual([
      { value: 'dark' },
    ]);
    expect(await db.query('SELECT name, settings_json FROM pen_presets')).toEqual([
      { name: 'Fine', settings_json: '{"width":2}' },
    ]);
    expect(await db.query('SELECT x, y, w, h FROM placements')).toEqual([
      { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
    ]);
  });

  it('no plaintext marker or %PDF in the raw database image or file store', async () => {
    const { store, db, backend } = await memoryStore();
    await seed(store);
    await db.close();
    const image = backend.image as Uint8Array;
    for (const m of [...Object.values(MARKERS), '%PDF', 'My signature'])
      expect(includes(image, m)).toBe(false);
    for (const f of backend.files.values()) {
      expect(includes(f, '%PDF')).toBe(false);
      expect(includes(f, MARKERS.pdf)).toBe(false);
    }
  });

  it('decrypts transparently through the DataStore', async () => {
    const { store } = await memoryStore();
    const { doc } = await seed(store);
    const got = await store.getDocument(doc.id);
    expect(got?.title).toBe(MARKERS.title);
    const pdf = await store.getDocumentPdf(doc);
    expect(fromUtf8(pdf)).toContain(MARKERS.pdf);
    expect(await sha256Hex(pdf)).toBe(doc.sha256);
    expect(await store.getSetting('signer_name')).toBe(MARKERS.signer);
    const [sig] = await store.select<{ svg_path: string }>('signatures');
    expect(sig?.svg_path).toBe(MARKERS.svg);
  });

  it('a different key cannot read the data', async () => {
    const { db, backend, store } = await memoryStore();
    const { doc } = await seed(store);
    const other = await DataStore.open(db, await newVault());
    await expect(other.getDocument(doc.id)).rejects.toBeInstanceOf(DecryptionError);
    await expect(other.getDocumentPdf(doc)).rejects.toBeInstanceOf(DecryptionError);
    expect(backend.files.size).toBe(3);
  });

  it('deleteDocument removes rows (cascade) and the document and export files', async () => {
    const { store, db, backend } = await memoryStore();
    const { doc } = await seed(store);
    expect(backend.files.size).toBe(3);
    await store.deleteDocument(doc.id);
    expect(await store.listDocuments()).toEqual([]);
    expect(await db.query('SELECT id FROM exports')).toEqual([]);
    expect(await db.query('SELECT id FROM placements')).toEqual([]);
    expect(backend.files.size).toBe(1); // the signature image stays
  });

  it('addDocument cleans up its file if the insert fails', async () => {
    const { store, db, backend } = await memoryStore();
    await db.exec('DROP TABLE documents');
    await expect(
      store.addDocument({ title: 't', pdf: fakePdf('x'), pageCount: 1 }),
    ).rejects.toThrow();
    expect(backend.files.size).toBe(0);
  });
});
