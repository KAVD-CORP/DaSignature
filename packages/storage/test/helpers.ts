import { MemoryBackend, MemoryStorageAdapter } from '../src/adapters/memory.ts';
import { randomBytes, toBase64, utf8 } from '../src/bytes.ts';
import type { KdfParams } from '../src/crypto/kdf.ts';
import type { VaultSource } from '../src/crypto/keys.ts';
import { importAesKey, Vault } from '../src/crypto/vault.ts';
import { DataStore } from '../src/datastore.ts';

/** Fast KDF for tests only; production parameters are asserted in crypto.test.ts. */
export const FAST_KDF = (): KdfParams => ({
  alg: 'pbkdf2-sha256',
  iterations: 1000,
  salt: toBase64(randomBytes(16)),
});

export const newVault = async () => new Vault(await importAesKey(randomBytes(32)));

export async function memoryStore(backend = new MemoryBackend(), vault?: Vault | VaultSource) {
  const db = new MemoryStorageAdapter(backend, { lockTimeoutMs: 500 });
  await db.init({});
  return { db, backend, store: await DataStore.open(db, vault ?? (await newVault())) };
}

/** A tiny but valid-looking PDF with recognisable marker text. */
export const fakePdf = (marker: string) =>
  utf8(`%PDF-1.7\n1 0 obj << /Title (${marker}) >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

export const MARKERS = {
  title: 'Confidential Lease Agreement ZQX',
  pdf: 'PDF-MARKER-ZQX-7731',
  svg: 'M10 10 C 20 20 ZQX-SVG-PATH',
  signer: 'Ama Owusu ZQX',
  template: 'Template ZQX',
};

export function includes(hay: Uint8Array, needle: string): boolean {
  const n = utf8(needle);
  outer: for (let i = 0; i + n.length <= hay.length; i++) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

/** Fills a store with one of everything, using the marker strings. */
export async function seed(store: DataStore) {
  const doc = await store.addDocument({
    title: MARKERS.title,
    pdf: fakePdf(MARKERS.pdf),
    pageCount: 2,
  });
  const sigId = '0190a000-0000-7000-8000-000000000001';
  await store.insert('signatures', {
    id: sigId,
    kind: 'signature',
    source: 'draw',
    name: 'My signature',
    strokes_json: JSON.stringify([[{ x: 1, y: 2, p: 0.5 }]]),
    svg_path: MARKERS.svg,
    image_ref: await store.putSealedFile('signatures', sigId, fakePdf('image bytes'), 'sig.png'),
    created_at: '2026-10-19T00:00:00.000Z',
  });
  await store.insert('placements', {
    id: '0190a000-0000-7000-8000-000000000002',
    document_id: doc.id,
    page_index: 0,
    type: 'signature',
    signature_id: sigId,
    x: 0.1,
    y: 0.2,
    w: 0.3,
    h: 0.1,
    data_json: JSON.stringify({ note: MARKERS.signer }),
  });
  const exp = await store.addExport({
    documentId: doc.id,
    pdf: fakePdf(MARKERS.pdf + '-signed'),
    signerName: MARKERS.signer,
  });
  await store.insert('pen_presets', { id: 'pp1', name: 'Fine', settings_json: '{"width":2}' });
  await store.insert('templates', {
    id: 't1',
    name: MARKERS.template,
    placements_json: '[{"x":1}]',
  });
  await store.setSetting('theme', 'dark');
  await store.setSetting('signer_name', MARKERS.signer);
  return { doc, exp, sigId };
}
