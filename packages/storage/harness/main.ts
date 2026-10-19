/**
 * Test-only page for PERSIST-01 / ENC-02 (served by test/persist.e2e.test.ts on port 4174).
 * Not part of apps/web. Fixture strings arrive from the test at runtime so they never appear in
 * this source (and so not in the browser's code cache on disk).
 */
import { WebStorageAdapter } from '../src/adapters/web.ts';
import { sha256Hex, utf8 } from '../src/bytes.ts';
import { IdbKeyValueStore, WebKeyManager } from '../src/crypto/keys.ts';
import { DataStore } from '../src/datastore.ts';
import { exportWebDataKey } from '../test/qa-harness.ts';

async function open() {
  const db = new WebStorageAdapter();
  await db.init({});
  const vault = await new WebKeyManager(new IdbKeyValueStore()).unlock();
  return { db, store: await DataStore.open(db, vault) };
}

const harness = {
  async write(title: string, pdfMarker: string) {
    const { db, store } = await open();
    const pdf = utf8(`%PDF-1.7\n(${pdfMarker})\n%%EOF\n`);
    const doc = await store.addDocument({ title, pdf, pageCount: 1 });
    await store.setSetting('signer_name', title);
    await db.close();
    return { id: doc.id, sha256: doc.sha256 };
  },
  /** TEST-ONLY hook (this page is never shipped): the raw data key, to prove it is not on disk. */
  async dataKeyHex() {
    const key = await exportWebDataKey(new IdbKeyValueStore());
    return [...key].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
  async read() {
    const { db, store } = await open();
    const docs = await store.listDocuments();
    const out = [];
    for (const d of docs)
      out.push({
        id: d.id,
        title: d.title,
        sha256: await sha256Hex(await store.getDocumentPdf(d)),
      });
    const signer = await store.getSetting('signer_name');
    await db.close();
    return { docs: out, signer };
  },
};
(window as unknown as { harness: typeof harness }).harness = harness;
document.title = 'ready';
